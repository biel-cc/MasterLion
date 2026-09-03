import { TextDecoder, TextEncoder } from 'node:util';

import type { SkillRegistryResult } from '@lobechat/context-engine';
import type { SkillRef } from '@lobechat/types/src/projectWorkspace';

import {
  assertSafeSkillName,
  joinAbsolute,
  normalizeRelativeSkillPath,
  resolveWithin,
} from './pathSafety';

export type HeterogeneousSkillCli = 'claude-code' | 'codex';

export interface SkillMaterializationFsAdapter {
  lstat: (path: string) => Promise<{ isDirectory: boolean; isSymbolicLink: boolean } | undefined>;
  mkdir: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string | Uint8Array | undefined>;
  /** Removes one previously verified Masterino-owned directory recursively. */
  removeDirectory: (path: string) => Promise<void>;
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
  removals: string[];
  status: 'materialized' | 'skipped' | 'unchanged';
  targetRoot?: string;
  writes: string[];
}

interface OwnershipManifest {
  /** Directory name to the registry key that last populated it. */
  entries: Record<string, string>;
  version: 1;
}

interface MaterializationPlan {
  directoryName: string;
  ref: SkillRef;
  skillRoot: string;
}

const MANIFEST_FILE = '.masterino-owned-skills.json';
const MASTERINO_DIRECTORY_PREFIX = 'masterino-';
const PROJECT_EXCLUDE_LINE = '/.claude/skills/masterino-*/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBytes = (value: string | Uint8Array): Uint8Array =>
  typeof value === 'string' ? encoder.encode(value) : value;

const toText = (value: string | Uint8Array): string =>
  typeof value === 'string' ? value : decoder.decode(value);

const equalContent = (left: string | Uint8Array, right: string | Uint8Array): boolean => {
  const a = toBytes(left);
  const b = toBytes(right);
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
};

const renderSkillMd = (ref: SkillRef): string | undefined => {
  if (!ref.content) return;
  if (/^---\s*\n/.test(ref.content)) return ref.content;
  return `---\nname: ${JSON.stringify(ref.name)}\ndescription: ${JSON.stringify(ref.description)}\n---\n\n${ref.content}`;
};

const appendExcludeLine = (current: string | undefined): string => {
  const lines = (current ?? '').split(/\r?\n/).filter(Boolean);
  if (lines.includes(PROJECT_EXCLUDE_LINE)) return current ?? PROJECT_EXCLUDE_LINE + '\n';
  return [...lines, PROJECT_EXCLUDE_LINE].join('\n') + '\n';
};

const getMaterializedDirectoryName = (ref: SkillRef): string => {
  for (const candidate of [ref.identifier, ref.name]) {
    try {
      assertSafeSkillName(candidate);
      return MASTERINO_DIRECTORY_PREFIX + candidate;
    } catch {
      // Try the next stable registry field; never synthesize or guess a path.
    }
  }
  throw new Error(`Skill ${ref.key} has no path-safe identifier or name.`);
};

const parseOwnershipManifest = (value: string | Uint8Array | undefined): OwnershipManifest => {
  if (value === undefined) return { entries: {}, version: 1 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(toText(value));
  } catch {
    throw new Error('Masterino skill ownership manifest is invalid.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Masterino skill ownership manifest is invalid.');
  }
  const candidate = parsed as { entries?: unknown; version?: unknown };
  if (!candidate.entries || typeof candidate.entries !== 'object' || candidate.version !== 1) {
    throw new Error('Masterino skill ownership manifest is invalid.');
  }

  const entries: Record<string, string> = {};
  for (const [directoryName, key] of Object.entries(candidate.entries)) {
    if (
      !directoryName.startsWith(MASTERINO_DIRECTORY_PREFIX) ||
      typeof key !== 'string' ||
      !key
    ) {
      throw new Error('Masterino skill ownership manifest is invalid.');
    }
    const safeName = directoryName.slice(MASTERINO_DIRECTORY_PREFIX.length);
    try {
      assertSafeSkillName(safeName);
    } catch {
      throw new Error('Masterino skill ownership manifest is invalid.');
    }
    entries[directoryName] = key;
  }

  return { entries, version: 1 };
};

const serializeOwnershipManifest = (entries: Record<string, string>): string => {
  const sortedEntries = Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({ entries: sortedEntries, version: 1 }, null, 2) + '\n';
};

/** Materializes only registry winners; repeated runs avoid writes when bytes are unchanged. */
export class HeterogeneousSkillMaterializer {
  constructor(private readonly fs: SkillMaterializationFsAdapter) {}

  async materialize(options: SkillMaterializationOptions): Promise<SkillMaterializationResult> {
    const mode = options.registry.policy.materializeForHeteroCli;
    const base: SkillMaterializationResult = {
      errors: [],
      mode,
      removals: [],
      status: 'skipped',
      writes: [],
    };
    if (mode === 'off') return { ...base, reason: 'disabled' };

    if (options.cli === 'codex') {
      return { ...base, reason: 'unsupported-current-directory' };
    }

    const targetRoot =
      mode === 'project'
        ? options.workspaceRoot && joinAbsolute(options.workspaceRoot, '.claude', 'skills')
        : options.userSkillsRoot;
    if (!targetRoot) return { ...base, reason: 'workspace-required' };

    const manifestPath = resolveWithin(targetRoot, MANIFEST_FILE);
    let manifest: OwnershipManifest;
    try {
      await this.assertNoSymlink(targetRoot);
      await this.assertNoSymlink(manifestPath);
      manifest = parseOwnershipManifest(await this.fs.readFile(manifestPath));
    } catch (error) {
      base.errors.push({
        key: 'ownership-manifest',
        message: error instanceof Error ? error.message : String(error),
      });
      return { ...base, status: 'unchanged', targetRoot };
    }

    const plans: MaterializationPlan[] = [];
    const plansByDirectory = new Map<string, MaterializationPlan[]>();
    for (const ref of options.registry.skills) {
      try {
        const directoryName = getMaterializedDirectoryName(ref);
        const plan = { directoryName, ref, skillRoot: resolveWithin(targetRoot, directoryName) };
        plans.push(plan);
        plansByDirectory.set(directoryName, [...(plansByDirectory.get(directoryName) ?? []), plan]);
      } catch (error) {
        base.errors.push({
          key: ref.key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const [directoryName, matchingPlans] of plansByDirectory) {
      if (matchingPlans.length < 2) continue;
      for (const { ref } of matchingPlans) {
        base.errors.push({
          key: ref.key,
          message: `Multiple registry skills resolve to ${directoryName}.`,
        });
      }
    }
    if ([...plansByDirectory.values()].some((matchingPlans) => matchingPlans.length > 1)) {
      return { ...base, status: 'unchanged', targetRoot };
    }

    // Preflight every destination before the first write or removal. An existing
    // directory without a manifest entry is foreign even when its name matches.
    for (const plan of plans) {
      try {
        await this.assertNoSymlink(plan.skillRoot);
        const stat = await this.fs.lstat(plan.skillRoot);
        const isOwned = Object.hasOwn(manifest.entries, plan.directoryName);
        if (stat && !isOwned) {
          throw new Error(`Refusing to replace foreign skill directory ${plan.directoryName}.`);
        }
        if (stat && !stat.isDirectory) {
          throw new Error(`Owned skill path ${plan.directoryName} is not a directory.`);
        }
      } catch (error) {
        base.errors.push({
          key: plan.ref.key,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (base.errors.length > 0) return { ...base, status: 'unchanged', targetRoot };

    await this.fs.mkdir(targetRoot);
    const nextEntries: Record<string, string> = {};
    const desiredDirectories = new Set(plans.map(({ directoryName }) => directoryName));

    for (const plan of plans) {
      let directoryPrepared = false;
      try {
        const defaultSkillMd = renderSkillMd(plan.ref);
        const bundle =
          (await options.resolveBundle?.(plan.ref)) ??
          (defaultSkillMd ? { 'SKILL.md': defaultSkillMd } : undefined);
        if (!bundle?.['SKILL.md']) {
          throw new Error('Skill content is unavailable for materialization.');
        }

        const targets = Object.entries(bundle).map(([relativePath, content]) => {
          const normalized = normalizeRelativeSkillPath(relativePath);
          return { content, target: resolveWithin(plan.skillRoot, normalized) };
        });
        for (const { target } of targets) await this.assertNoSymlink(target);

        await this.fs.mkdir(plan.skillRoot);
        directoryPrepared = true;
        for (const { content, target } of targets) {
          const parent = target.slice(
            0,
            Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')),
          );
          if (parent) await this.fs.mkdir(parent);
          const existing = await this.fs.readFile(target);
          if (existing !== undefined && equalContent(existing, content)) continue;
          await this.fs.writeFile(target, content);
          base.writes.push(target);
        }
        nextEntries[plan.directoryName] = plan.ref.key;
      } catch (error) {
        base.errors.push({
          key: plan.ref.key,
          message: error instanceof Error ? error.message : String(error),
        });
        if (Object.hasOwn(manifest.entries, plan.directoryName) || directoryPrepared) {
          nextEntries[plan.directoryName] =
            manifest.entries[plan.directoryName] ?? plan.ref.key;
        }
      }
    }

    for (const [directoryName, key] of Object.entries(manifest.entries)) {
      if (desiredDirectories.has(directoryName)) continue;
      const staleRoot = resolveWithin(targetRoot, directoryName);
      try {
        await this.assertNoSymlink(staleRoot);
        const stat = await this.fs.lstat(staleRoot);
        if (stat && !stat.isDirectory) {
          throw new Error(`Owned skill path ${directoryName} is not a directory.`);
        }
        if (stat) {
          await this.fs.removeDirectory(staleRoot);
          base.removals.push(staleRoot);
        }
      } catch (error) {
        base.errors.push({
          key,
          message: error instanceof Error ? error.message : String(error),
        });
        nextEntries[directoryName] = key;
      }
    }

    const currentManifest = await this.fs.readFile(manifestPath);
    const nextManifest = serializeOwnershipManifest(nextEntries);
    if (currentManifest === undefined || !equalContent(currentManifest, nextManifest)) {
      await this.fs.writeFile(manifestPath, nextManifest);
      base.writes.push(manifestPath);
    }

    if (mode === 'project' && options.workspaceRoot) {
      const gitExcludePath =
        options.gitExcludePath ?? joinAbsolute(options.workspaceRoot, '.git', 'info', 'exclude');
      await this.assertNoSymlink(gitExcludePath);
      const current = await this.fs.readFile(gitExcludePath);
      const currentText = current === undefined ? undefined : toText(current);
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
      status: base.writes.length > 0 || base.removals.length > 0 ? 'materialized' : 'unchanged',
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
