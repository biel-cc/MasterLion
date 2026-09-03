import { TextEncoder } from 'node:util';

import { type Zippable,zipSync } from 'fflate';
import matter from 'gray-matter';

import {
  assertSafeSkillName,
  joinAbsolute,
  normalizeRelativeSkillPath,
  resolveWithin,
} from './pathSafety';

export const MAX_PROJECT_SKILL_FILE_BYTES = 1024 * 1024;
export const MAX_PROJECT_SKILL_FILES = 256;
export const MAX_PROJECT_SKILL_TOTAL_BYTES = 16 * 1024 * 1024;

export interface ProjectSkillFsStat {
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  size: number;
}

/**
 * Device-backed filesystem adapter. Mutating methods must use no-follow semantics
 * at the final path component; the service validates every existing ancestor.
 */
export interface ProjectSkillFsAdapter {
  listFiles: (directory: string) => Promise<string[]>;
  lstat: (path: string) => Promise<ProjectSkillFsStat | undefined>;
  mkdir: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string | Uint8Array>;
  remove: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>;
}

export interface ProjectSkillValidationResult {
  errors: string[];
  files: string[];
  manifest?: { description: string; name: string };
  totalBytes: number;
  valid: boolean;
}

export interface CreateProjectSkillInput {
  content: string;
  name: string;
  resources?: Record<string, string | Uint8Array>;
}

export interface UpdateProjectSkillInput {
  content: string | Uint8Array;
  name: string;
  path: string;
}

export interface PromoteProjectSkillAdapter<TResult = unknown> {
  importProjectSkill: (input: {
    archive: Uint8Array;
    manifest: { description: string; name: string };
  }) => Promise<TResult>;
}

const bytes = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

const text = (content: string | Uint8Array): string =>
  typeof content === 'string' ? content : new TextDecoder().decode(content);

const parseManifest = (
  content: string,
  expectedName: string,
): { description: string; name: string } => {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch {
    throw new ProjectSkillValidationError('SKILL.md frontmatter is not valid YAML.');
  }

  const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() : '';
  const description =
    typeof parsed.data.description === 'string' ? parsed.data.description.trim() : '';
  if (!name || !description) {
    throw new ProjectSkillValidationError('SKILL.md requires non-empty name and description.');
  }
  assertSafeSkillName(name);
  if (name !== expectedName) {
    throw new ProjectSkillValidationError(
      `SKILL.md name "${name}" must match directory "${expectedName}".`,
    );
  }
  if (!parsed.content.trim()) {
    throw new ProjectSkillValidationError('SKILL.md requires an instruction body.');
  }
  return { description, name };
};

export class ProjectSkillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSkillValidationError';
  }
}

export class ProjectSkillService {
  private readonly skillsRoot: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly fs: ProjectSkillFsAdapter,
  ) {
    this.skillsRoot = joinAbsolute(workspaceRoot, '.agents', 'skills');
  }

  async create(input: CreateProjectSkillInput): Promise<ProjectSkillValidationResult> {
    assertSafeSkillName(input.name);
    parseManifest(input.content, input.name);
    this.assertContentSize('SKILL.md', input.content);

    const skillRoot = this.skillRoot(input.name);
    await this.assertNoSymlink(skillRoot);
    if (await this.fs.lstat(skillRoot)) {
      throw new ProjectSkillValidationError(`Project skill already exists: ${input.name}`);
    }

    const resources = input.resources ?? {};
    if (Object.keys(resources).length + 1 > MAX_PROJECT_SKILL_FILES) {
      throw new ProjectSkillValidationError('Project skill contains too many files.');
    }
    let totalBytes = bytes(input.content).byteLength;
    for (const [relativePath, content] of Object.entries(resources)) {
      normalizeRelativeSkillPath(relativePath);
      if (relativePath.toUpperCase() === 'SKILL.MD') {
        throw new ProjectSkillValidationError('Resources cannot replace SKILL.md.');
      }
      this.assertContentSize(relativePath, content);
      totalBytes += bytes(content).byteLength;
    }
    if (totalBytes > MAX_PROJECT_SKILL_TOTAL_BYTES) {
      throw new ProjectSkillValidationError('Project skill exceeds the total size limit.');
    }

    await this.fs.mkdir(skillRoot);
    await this.fs.writeFile(resolveWithin(skillRoot, 'SKILL.md'), input.content);
    for (const [relativePath, content] of Object.entries(resources)) {
      const normalized = normalizeRelativeSkillPath(relativePath);
      const target = resolveWithin(skillRoot, normalized);
      const parent = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')));
      if (parent) await this.fs.mkdir(parent);
      await this.assertNoSymlink(target);
      await this.fs.writeFile(target, content);
    }

    return this.assertValidAfterWrite(input.name);
  }

  async update(input: UpdateProjectSkillInput): Promise<ProjectSkillValidationResult> {
    assertSafeSkillName(input.name);
    const normalized = normalizeRelativeSkillPath(input.path);
    this.assertContentSize(normalized, input.content);
    if (normalized === 'SKILL.md') parseManifest(text(input.content), input.name);

    const skillRoot = this.skillRoot(input.name);
    const target = resolveWithin(skillRoot, normalized);
    await this.assertSkillDirectory(skillRoot);
    await this.assertNoSymlink(target);
    const existingFiles = await this.safeFileList(skillRoot);
    if (!existingFiles.includes(normalized) && existingFiles.length >= MAX_PROJECT_SKILL_FILES) {
      throw new ProjectSkillValidationError('Project skill contains too many files.');
    }
    let projectedTotalBytes = bytes(input.content).byteLength;
    for (const relativePath of existingFiles) {
      if (relativePath === normalized) continue;
      const existingPath = resolveWithin(skillRoot, relativePath);
      await this.assertNoSymlink(existingPath);
      projectedTotalBytes += (await this.fs.lstat(existingPath))?.size ?? 0;
    }
    if (projectedTotalBytes > MAX_PROJECT_SKILL_TOTAL_BYTES) {
      throw new ProjectSkillValidationError('Project skill exceeds the total size limit.');
    }
    const parent = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')));
    if (parent) await this.fs.mkdir(parent);
    await this.fs.writeFile(target, input.content);
    return this.assertValidAfterWrite(input.name);
  }

  async rename(name: string, newName: string): Promise<ProjectSkillValidationResult> {
    assertSafeSkillName(name);
    assertSafeSkillName(newName);
    const from = this.skillRoot(name);
    const to = this.skillRoot(newName);
    await this.assertSkillDirectory(from);
    await this.assertNoSymlink(to);
    if (await this.fs.lstat(to)) {
      throw new ProjectSkillValidationError(`Project skill already exists: ${newName}`);
    }

    const currentSkillMd = text(await this.fs.readFile(resolveWithin(from, 'SKILL.md')));
    const parsed = matter(currentSkillMd);
    // gray-matter caches parse results; never mutate parsed.data or a later parse
    // of the same source string can observe the renamed value.
    const renamedSkillMd = matter.stringify(parsed.content, { ...parsed.data, name: newName });
    parseManifest(renamedSkillMd, newName);

    await this.fs.rename(from, to);
    await this.fs.writeFile(resolveWithin(to, 'SKILL.md'), renamedSkillMd);
    return this.assertValidAfterWrite(newName);
  }

  async delete(name: string): Promise<void> {
    assertSafeSkillName(name);
    const skillRoot = this.skillRoot(name);
    await this.assertSkillDirectory(skillRoot);
    const files = await this.safeFileList(skillRoot);
    for (const relativePath of files) {
      await this.assertNoSymlink(resolveWithin(skillRoot, relativePath));
    }
    await this.fs.remove(skillRoot);
  }

  async validate(name: string): Promise<ProjectSkillValidationResult> {
    assertSafeSkillName(name);
    const errors: string[] = [];
    let files: string[] = [];
    let totalBytes = 0;
    let manifest: ProjectSkillValidationResult['manifest'];
    const skillRoot = this.skillRoot(name);

    try {
      await this.assertSkillDirectory(skillRoot);
      files = await this.safeFileList(skillRoot);
      if (files.length > MAX_PROJECT_SKILL_FILES) {
        errors.push(`Project skill exceeds ${MAX_PROJECT_SKILL_FILES} files.`);
      }
      if (!files.includes('SKILL.md')) errors.push('SKILL.md is missing.');

      for (const relativePath of files) {
        const fullPath = resolveWithin(skillRoot, relativePath);
        await this.assertNoSymlink(fullPath);
        const stat = await this.fs.lstat(fullPath);
        if (!stat?.isFile) {
          errors.push(`Not a regular file: ${relativePath}`);
          continue;
        }
        totalBytes += stat.size;
        if (stat.size > MAX_PROJECT_SKILL_FILE_BYTES) {
          errors.push(`${relativePath} exceeds the per-file size limit.`);
        }
      }

      if (totalBytes > MAX_PROJECT_SKILL_TOTAL_BYTES) {
        errors.push('Project skill exceeds the total size limit.');
      }

      if (files.includes('SKILL.md')) {
        try {
          manifest = parseManifest(
            text(await this.fs.readFile(resolveWithin(skillRoot, 'SKILL.md'))),
            name,
          );
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    return { errors, files, manifest, totalBytes, valid: errors.length === 0 };
  }

  async pack(name: string): Promise<Uint8Array> {
    const validation = await this.validate(name);
    if (!validation.valid) throw new ProjectSkillValidationError(validation.errors.join(' '));

    const skillRoot = this.skillRoot(name);
    const archive: Zippable = {};
    const fixedMtime = new Date('1980-01-01T00:00:00.000Z');
    for (const relativePath of [...validation.files].sort()) {
      const content = bytes(await this.fs.readFile(resolveWithin(skillRoot, relativePath)));
      archive[relativePath] = [content, { mtime: fixedMtime }];
    }
    return zipSync(archive, { level: 6 });
  }

  async promoteToUser<TResult>(
    name: string,
    adapter: PromoteProjectSkillAdapter<TResult>,
  ): Promise<TResult> {
    const validation = await this.validate(name);
    if (!validation.valid || !validation.manifest) {
      throw new ProjectSkillValidationError(validation.errors.join(' '));
    }
    const archive = await this.pack(name);
    return adapter.importProjectSkill({ archive, manifest: validation.manifest });
  }

  private async assertValidAfterWrite(name: string): Promise<ProjectSkillValidationResult> {
    const validation = await this.validate(name);
    if (!validation.valid) throw new ProjectSkillValidationError(validation.errors.join(' '));
    return validation;
  }

  private assertContentSize(relativePath: string, content: string | Uint8Array): void {
    if (bytes(content).byteLength > MAX_PROJECT_SKILL_FILE_BYTES) {
      throw new ProjectSkillValidationError(`${relativePath} exceeds the per-file size limit.`);
    }
  }

  private async assertNoSymlink(target: string): Promise<void> {
    const separators = /[/\\]+/;
    const workspaceParts = this.workspaceRoot.split(separators).filter(Boolean);
    const targetParts = target.split(separators).filter(Boolean);
    const isWindows = /^[a-z]:/i.test(target);
    let current = isWindows ? `${targetParts.shift()}\\` : '/';

    for (const part of targetParts) {
      current = joinAbsolute(current, part);
      if (current.split(separators).filter(Boolean).length <= workspaceParts.length) continue;
      const stat = await this.fs.lstat(current);
      if (stat?.isSymbolicLink) {
        throw new ProjectSkillValidationError(`Symbolic links are not allowed: ${current}`);
      }
    }
  }

  private async assertSkillDirectory(skillRoot: string): Promise<void> {
    await this.assertNoSymlink(skillRoot);
    const stat = await this.fs.lstat(skillRoot);
    if (!stat?.isDirectory) {
      throw new ProjectSkillValidationError(`Project skill not found: ${skillRoot}`);
    }
  }

  private async safeFileList(skillRoot: string): Promise<string[]> {
    const files = await this.fs.listFiles(skillRoot);
    return files.map(normalizeRelativeSkillPath).sort();
  }

  private skillRoot(name: string): string {
    return resolveWithin(this.skillsRoot, name);
  }
}
