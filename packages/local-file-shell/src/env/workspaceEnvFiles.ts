import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const parseValue = (raw: string): string => {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const match = /^("(?:[^"\\]|\\.)*")(?:\s*#.*)?$/.exec(value);
    if (!match) throw new Error('Invalid workspace environment file value.');
    return JSON.parse(match[1]) as string;
  }
  if (value.startsWith("'")) {
    const match = /^'([^']*)'(?:\s*#.*)?$/.exec(value);
    if (!match) throw new Error('Invalid workspace environment file value.');
    return match[1];
  }
  return value.replace(/\s+#.*$/, '').trimEnd();
};

const parseDotenv = (source: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const sourceLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separator = assignment.indexOf('=');
    if (separator <= 0) throw new Error('Invalid workspace environment file entry.');
    const key = assignment.slice(0, separator).trim();
    if (!ENV_KEY_PATTERN.test(key)) throw new Error('Invalid workspace environment variable name.');
    result[key] = parseValue(assignment.slice(separator + 1));
  }
  return result;
};

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export interface LoadWorkspaceEnvFilesInput {
  envFiles?: readonly string[];
  workspaceRootPath?: string;
}

/** Device-authoritative dotenv loader. Paths and symlinks may never escape the workspace. */
export const loadWorkspaceEnvFiles = async ({
  envFiles,
  workspaceRootPath,
}: LoadWorkspaceEnvFilesInput): Promise<Record<string, string>> => {
  if (!envFiles?.length) return {};
  if (!workspaceRootPath) throw new Error('Workspace root is required for environment files.');
  const root = await realpath(workspaceRootPath);
  const result: Record<string, string> = {};

  for (const envFile of envFiles) {
    if (!envFile || path.isAbsolute(envFile)) {
      throw new Error('Workspace environment file paths must be relative.');
    }
    const lexicalPath = path.resolve(root, envFile);
    if (!isWithin(root, lexicalPath)) {
      throw new Error('Workspace environment file must stay inside the workspace.');
    }
    const canonicalPath = await realpath(lexicalPath);
    if (!isWithin(root, canonicalPath)) {
      throw new Error('Workspace environment file must stay inside the workspace.');
    }
    Object.assign(result, parseDotenv(await readFile(canonicalPath, 'utf8')));
  }
  return result;
};
