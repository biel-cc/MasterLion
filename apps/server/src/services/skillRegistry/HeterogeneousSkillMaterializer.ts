import { TextEncoder } from 'node:util';

import type { SkillRegistryResult } from '@lobechat/context-engine';
import type { SkillRef } from '@lobechat/types/src/projectWorkspace';

import { assertSafeSkillName, joinAbsolute, normalizeRelativeSkillPath, resolveWithin } from './pathSafety';

export type HeterogeneousSkillCli = 'claude-code' | 'codex';

export interface SkillMaterializationFsAdapter {
  lstat: (path: string) => Promise<{ isDirectory: boolean; isSymbolicLink: boolean } | undefined>;
  mkdir: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string | Uint8Array | undefined>;
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>;
}

export interface SkillMaterializationOptions {
  cli: HeterogeneousSkillCli;
  /** Required for worktrees whose .git entry is a file rather than a directory. */
  gitExcludePath?: string;
  registry: SkillRegistryResult;
  resolveBundle?: (ref: SkillRef) => Promise<Record<string, string | Uint8Array> | undefined>;
  /** Explicit user skill root (for example ~/.claude/skills after host-side resolution). */
  userSkillsRoot?: string;
  workspaceRoot?: string;
}

export interface SkillMaterializationResult {
  errors: Array<{ key: string; message: string }>;
  mode: SkillRegistryResult['policy']['materializeForHeteroCli'];
  reason?: 'disabled' | 'unsupported-current-directory' | 'workspace-required';
  status: 'materialized' | 'skipped' | 'unchanged';
  targetRoot?: string;
  writes: string[];
}

const encoder = new TextEncoder();
const toBytes = (value: string | Uint8Array): Uint8Array =>
  typeof value === 'string' ? encoder.encode(value) : value;

const equalContent = (left: string | Uint8Array, right: string | Uint8Array): boolean => {
  const a = toBytes(left);
  const b = toBytes(right);
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
};

const renderSkillMd = (ref: SkillRef): string | undefined => {
  if (!ref.content) return;
  if (/^---\s*\r?\n/.test(ref.content)) return ref.content;
  return `---\nname: ${JSON.stringify(ref.name)}\ndescription: ${JSON.stringify(ref.description)}\n---\n\n${ref.content}`;
};

const appendExcludeLine = (current: string | undefined): string => {
  const line = '/.claude/skills/';
  const lines = (current ?? '').split(/\r?\n/).filter(Boolean);
  if (lines.includes(line)) return current ?? line + '\n';
  return [...lines, line].join('\n') + '\n';
};

const getMaterializedDirectoryName = (ref: SkillRef): string => {
  for (const candidate of [ref.identifier, ref.name]) {
    try {
      assertSafeSkillName(candidate);
      return candidate;
    } catch {
      // Try the next stable registry field; never synthesize or guess a path.
    }
  }
  throw new Error(`Skill ${ref.key} has no path-safe identifier or name.`);
};

/** Materializes only registry winners; repeated runs avoid writes when bytes are unchanged. */
export class HeterogeneousSkillMaterializer {
  constructor(private readonly fs: SkillMaterializationFsAdapter) {}

  async materialize(options: SkillMaterializationOptions): Promise<SkillMaterializationResult> {
    const mode = options.registry.policy.materializeForHeteroCli;
    const base: SkillMaterializationResult = { errors: [], mode, status: 'skipped', writes: [] };
    if (mode === 'off') return { ...base, reason: 'disabled' };

    if (options.cli === 'codex') {
      return { ...base, reason: 'unsupported-current-directory' };
    }

    const targetRoot =
      mode === 'project'
        ? options.workspaceRoot && joinAbsolute(options.workspaceRoot, '.claude', 'skills')
        : options.userSkillsRoot;
    if (!targetRoot) return { ...base, reason: 'workspace-required' };

    await this.assertNoSymlink(targetRoot);
    await this.fs.mkdir(targetRoot);

    for (const ref of options.registry.skills) {
      try {
        const directoryName = getMaterializedDirectoryName(ref);
        const skillRoot = resolveWithin(targetRoot, directoryName);
        await this.assertNoSymlink(skillRoot);
        await this.fs.mkdir(skillRoot);

        const defaultSkillMd = renderSkillMd(ref);
        const bundle =
          (await options.resolveBundle?.(ref)) ??
          (defaultSkillMd ? { 'SKILL.md': defaultSkillMd } : undefined);
        if (!bundle?.['SKILL.md']) {
          throw new Error('Skill content is unavailable for materialization.');
        }

        for (const [relativePath, content] of Object.entries(bundle)) {
          const normalized = normalizeRelativeSkillPath(relativePath);
          const target = resolveWithin(skillRoot, normalized);
          await this.assertNoSymlink(target);
          const parent = target.slice(0, Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')));
          if (parent) await this.fs.mkdir(parent);
          const existing = await this.fs.readFile(target);
          if (existing !== undefined && equalContent(existing, content)) continue;
          await this.fs.writeFile(target, content);
          base.writes.push(target);
        }
      } catch (error) {
        base.errors.push({
          key: ref.key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (mode === 'project' && options.workspaceRoot) {
      const gitExcludePath =
        options.gitExcludePath ?? joinAbsolute(options.workspaceRoot, '.git', 'info', 'exclude');
      await this.assertNoSymlink(gitExcludePath);
      const current = await this.fs.readFile(gitExcludePath);
      const currentText =
        current === undefined
          ? undefined
          : typeof current === 'string'
            ? current
            : new TextDecoder().decode(current);
      const next = appendExcludeLine(currentText);
      if (currentText !== next) {
        const parent = gitExcludePath.slice(
          0,
          Math.max(gitExcludePath.lastIndexOf('/'), gitExcludePath.lastIndexOf('\\')),
        );
        if (parent) await this.fs.mkdir(parent);
        await this.fs.writeFile(gitExcludePath, next);
        base.writes.push(gitExcludePath);
      }
    }

    return {
      ...base,
      status: base.writes.length > 0 ? 'materialized' : 'unchanged',
      targetRoot,
    };
  }

  private async assertNoSymlink(target: string): Promise<void> {
    const isWindows = /^[a-z]:[/\\]/i.test(target);
    const parts = target.split(/[/\\]+/).filter(Boolean);
    let current = isWindows ? `${parts.shift()}\\` : '/';
    for (const part of parts) {
      current = joinAbsolute(current, part);
      const stat = await this.fs.lstat(current);
      if (stat?.isSymbolicLink) throw new Error(`Symbolic links are not allowed: ${current}`);
    }
  }
}
