import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';

import { ExecutionEnvError } from './errors';
import { assertConfigurableExecutionEnvKey } from './validation';

export interface ParseExecutionEnvFileOptions {
  secretKeys?: Iterable<string>;
}

const invalidLine = (lineNumber: number) =>
  new ExecutionEnvError(
    'INVALID_ENV_FILE',
    `Invalid environment file entry at line ${lineNumber}.`,
  );

const parseDoubleQuotedValue = (raw: string, lineNumber: number): string => {
  let escaped = false;
  let closingIndex = -1;

  for (let index = 1; index < raw.length; index++) {
    const character = raw[index];
    if (!escaped && character === '"') {
      closingIndex = index;
      break;
    }
    escaped = !escaped && character === '\\';
    if (character !== '\\') escaped = false;
  }

  if (closingIndex < 0 || !/^(?:\s*#.*)?$/.test(raw.slice(closingIndex + 1))) {
    throw invalidLine(lineNumber);
  }

  const quoted = raw.slice(0, closingIndex + 1);
  try {
    return JSON.parse(quoted) as string;
  } catch {
    throw invalidLine(lineNumber);
  }
};

const parseSingleQuotedValue = (raw: string, lineNumber: number): string => {
  const closingIndex = raw.indexOf("'", 1);
  if (closingIndex < 0 || !/^(?:\s*#.*)?$/.test(raw.slice(closingIndex + 1))) {
    throw invalidLine(lineNumber);
  }
  return raw.slice(1, closingIndex);
};

const parseValue = (raw: string, lineNumber: number): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) return parseDoubleQuotedValue(trimmed, lineNumber);
  if (trimmed.startsWith("'")) return parseSingleQuotedValue(trimmed, lineNumber);
  return trimmed.replace(/\s+#.*$/, '').trimEnd();
};

/** Parse dotenv text without interpolation. Error messages never copy source values. */
export const parseExecutionEnvFile = (
  content: string,
  options: ParseExecutionEnvFileOptions = {},
): ProjectWorkspaceEnvRecord => {
  const secretKeys = new Set(options.secretKeys ?? []);
  const result: ProjectWorkspaceEnvRecord = {};

  for (const [index, sourceLine] of content.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;

    const assignment =
      line.startsWith('export') && /\s/u.test(line['export'.length] ?? '')
        ? line.slice('export'.length).trimStart()
        : line;
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex <= 0) throw invalidLine(lineNumber);

    const key = assignment.slice(0, separatorIndex).trimEnd();
    if (!key || /\s/u.test(key)) throw invalidLine(lineNumber);
    const rawValue = assignment.slice(separatorIndex + 1).trimStart();
    try {
      assertConfigurableExecutionEnvKey(key);
    } catch (error) {
      if (error instanceof ExecutionEnvError) throw error;
      throw invalidLine(lineNumber);
    }

    result[key] = {
      secret: secretKeys.has(key),
      value: parseValue(rawValue, lineNumber),
    };
  }

  return result;
};

export const parseEnvFile = parseExecutionEnvFile;
