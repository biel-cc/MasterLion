import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';
import { type Zippable,zipSync } from 'fflate';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 256;
const MAX_PACKED_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface DeviceProjectSkillValidation {
  errors: string[];
  files: string[];
  manifest?: { description: string; name: string };
  totalBytes: number;
  valid: boolean;
}

export interface DeviceProjectSkillTarget {
  name: string;
  scope: string;
}

export interface DeviceProjectSkillCreate extends DeviceProjectSkillTarget {
  content: string;
}

export interface DeviceProjectSkillUpdate extends DeviceProjectSkillCreate {
  path: string;
}

export interface DeviceProjectSkillRename extends DeviceProjectSkillTarget {
  newName: string;
}

export interface DeviceProjectSkillPackResult {
  archiveBase64: string;
  size: number;
  validation: DeviceProjectSkillValidation;
}

const assertSafeName = (name: string): void => {
  if (!SAFE_NAME.test(name)) throw new Error('INVALID_SKILL_NAME');
};

const normalizeRelativePath = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('INVALID_SKILL_PATH');
  }
  return normalized;
};

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const parseManifest = (
  content: string,
  expectedName: string,
): { description: string; name: string } => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!frontmatter) throw new Error('SKILL_FRONTMATTER_REQUIRED');

  const fields: Record<string, string> = {};
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  assertSafeName(fields.name ?? '');
  if (fields.name !== expectedName) throw new Error('SKILL_NAME_MISMATCH');
  if (!fields.description || fields.description.length > 1024) {
    throw new Error('SKILL_DESCRIPTION_INVALID');
  }
  if (!frontmatter[2].trim()) throw new Error('SKILL_BODY_REQUIRED');
  return { description: fields.description, name: fields.name };
};

const getRoots = async (scope: string, name: string) => {
  assertSafeName(name);
  if (!path.isAbsolute(scope)) throw new Error('WORKSPACE_REQUIRED');
  const workspaceRoot = await realpath(scope);
  const skillsRoot = path.join(workspaceRoot, '.agents', 'skills');
  const skillRoot = path.join(skillsRoot, name);
  if (!isWithin(workspaceRoot, skillRoot)) throw new Error('SCOPE_DENIED');
  return { skillRoot, skillsRoot, workspaceRoot };
};

const assertNoSymlinks = async (workspaceRoot: string, target: string): Promise<void> => {
  if (!isWithin(workspaceRoot, target)) throw new Error('SCOPE_DENIED');
  const relative = path.relative(workspaceRoot, target);
  let current = workspaceRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await lstat(current).catch(() => undefined);
    if (entry?.isSymbolicLink()) throw new Error('SCOPE_DENIED');
  }
};

const listFiles = async (skillRoot: string): Promise<string[]> =>
  (
    await fg('**/*', {
      absolute: false,
      cwd: skillRoot,
      dot: false,
      followSymbolicLinks: false,
      onlyFiles: true,
    })
  )
    .map(normalizeRelativePath)
    .sort();

export const validateProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<DeviceProjectSkillValidation> => {
  const errors: string[] = [];
  let files: string[] = [];
  let manifest: DeviceProjectSkillValidation['manifest'];
  let totalBytes = 0;

  try {
    const { skillRoot, workspaceRoot } = await getRoots(input.scope, input.name);
    await assertNoSymlinks(workspaceRoot, skillRoot);
    if (!(await stat(skillRoot)).isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
    files = await listFiles(skillRoot);
    if (!files.includes('SKILL.md')) errors.push('SKILL.md is missing.');
    if (files.length > MAX_FILES) errors.push(`Project skill exceeds ${MAX_FILES} files.`);

    for (const relativePath of files) {
      const target = path.join(skillRoot, relativePath);
      await assertNoSymlinks(workspaceRoot, target);
      const targetStat = await lstat(target);
      if (!targetStat.isFile()) {
        errors.push(`Not a regular file: ${relativePath}`);
        continue;
      }
      totalBytes += targetStat.size;
      if (targetStat.size > MAX_FILE_BYTES) errors.push(`${relativePath} is too large.`);
    }
    if (totalBytes > MAX_TOTAL_BYTES) errors.push('Project skill exceeds the total size limit.');

    if (files.includes('SKILL.md')) {
      try {
        manifest = parseManifest(
          await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'),
          input.name,
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { errors, files, manifest, totalBytes, valid: errors.length === 0 };
};

export const createProjectSkillOnDevice = async (
  input: DeviceProjectSkillCreate,
): Promise<DeviceProjectSkillValidation> => {
  assertSafeName(input.name);
  parseManifest(input.content, input.name);
  if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) throw new Error('SKILL_FILE_TOO_LARGE');
  const { skillRoot, skillsRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  await assertNoSymlinks(workspaceRoot, skillsRoot);
  await mkdir(skillsRoot, { recursive: true });
  await assertNoSymlinks(workspaceRoot, skillRoot);
  await mkdir(skillRoot);
  await writeFile(path.join(skillRoot, 'SKILL.md'), input.content, { flag: 'wx' });
  const validation = await validateProjectSkillOnDevice(input);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return validation;
};

export const updateProjectSkillOnDevice = async (
  input: DeviceProjectSkillUpdate,
): Promise<DeviceProjectSkillValidation> => {
  const relativePath = normalizeRelativePath(input.path);
  if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) throw new Error('SKILL_FILE_TOO_LARGE');
  if (relativePath === 'SKILL.md') parseManifest(input.content, input.name);
  const { skillRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  await assertNoSymlinks(workspaceRoot, skillRoot);
  if (!(await stat(skillRoot)).isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
  const target = path.join(skillRoot, ...relativePath.split('/'));
  await assertNoSymlinks(workspaceRoot, target);
  await mkdir(path.dirname(target), { recursive: true });
  await assertNoSymlinks(workspaceRoot, target);
  await writeFile(target, input.content);
  const validation = await validateProjectSkillOnDevice(input);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return validation;
};

export const renameProjectSkillOnDevice = async (
  input: DeviceProjectSkillRename,
): Promise<DeviceProjectSkillValidation> => {
  assertSafeName(input.newName);
  const source = await getRoots(input.scope, input.name);
  const destination = await getRoots(input.scope, input.newName);
  await assertNoSymlinks(source.workspaceRoot, source.skillRoot);
  await assertNoSymlinks(destination.workspaceRoot, destination.skillRoot);
  if (await lstat(destination.skillRoot).catch(() => undefined)) throw new Error('ALREADY_EXISTS');

  const skillMd = await readFile(path.join(source.skillRoot, 'SKILL.md'), 'utf8');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd);
  if (!frontmatter || !/^\s*name\s*:/m.test(frontmatter[1])) {
    throw new Error('SKILL_FRONTMATTER_REQUIRED');
  }
  const nextFrontmatter = frontmatter[1].replace(/^\s*name\s*:.*$/m, `name: ${input.newName}`);
  const renamedSkillMd = skillMd.replace(frontmatter[1], nextFrontmatter);
  parseManifest(renamedSkillMd, input.newName);

  await rename(source.skillRoot, destination.skillRoot);
  await writeFile(path.join(destination.skillRoot, 'SKILL.md'), renamedSkillMd);
  const validation = await validateProjectSkillOnDevice({
    name: input.newName,
    scope: input.scope,
  });
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return validation;
};

export const deleteProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<void> => {
  const { skillRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  await assertNoSymlinks(workspaceRoot, skillRoot);
  if (!(await stat(skillRoot)).isDirectory()) throw new Error('PROJECT_SKILL_NOT_FOUND');
  await rm(skillRoot, { recursive: true });
};

export const packProjectSkillOnDevice = async (
  input: DeviceProjectSkillTarget,
): Promise<DeviceProjectSkillPackResult> => {
  const validation = await validateProjectSkillOnDevice(input);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const { skillRoot, workspaceRoot } = await getRoots(input.scope, input.name);
  const archive: Zippable = {};
  for (const relativePath of validation.files) {
    const target = path.join(skillRoot, ...relativePath.split('/'));
    await assertNoSymlinks(workspaceRoot, target);
    archive[relativePath] = [await readFile(target), { mtime: new Date('1980-01-01T00:00:00Z') }];
  }
  const packed = zipSync(archive, { level: 6 });
  if (packed.byteLength > MAX_PACKED_BYTES) throw new Error('PROJECT_SKILL_ARCHIVE_TOO_LARGE');
  return {
    archiveBase64: Buffer.from(packed).toString('base64'),
    size: packed.byteLength,
    validation,
  };
};
