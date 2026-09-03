import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type HeterogeneousSkillCli = 'claude-code' | 'codex';
export type HeterogeneousSkillMaterializationMode = 'off' | 'project' | 'user';

export interface MaterializableSkill {
  content?: string;
  description: string;
  identifier: string;
  key: string;
  name: string;
  source: string;
}

export interface MaterializableSkillRegistry {
  policy: { materializeForHeteroCli: HeterogeneousSkillMaterializationMode };
  skills: MaterializableSkill[];
}

export interface SkillMaterializationFsAdapter {
  lstat: (path: string) => Promise<{ isDirectory: boolean; isSymbolicLink: boolean } | undefined>;
  mkdir: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string | Uint8Array | undefined>;
  removeDirectory: (path: string) => Promise<void>;
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>;
}

export interface SkillMaterializationOptions {
  cli: HeterogeneousSkillCli;
  gitExcludePath?: string;
  registry: MaterializableSkillRegistry;
  resolveBundle?: (
    ref: MaterializableSkill,
  ) => Promise<Record<string, string | Uint8Array> | undefined>;
  userSkillsRoot?: string;
  workspaceRoot?: string;
}

export interface SkillMaterializationResult {
  errors: Array<{ key: string; message: string }>;
  mode: HeterogeneousSkillMaterializationMode;
  reason?:
    | 'disabled'
    | 'unsupported-agent'
    | 'unsupported-current-directory'
    | 'workspace-required';
  removals: string[];
  status: 'materialized' | 'skipped' | 'unchanged';
  targetRoot?: string;
  writes: string[];
}

interface OwnershipManifest {
  entries: Record<string, string>;
  version: 1;
}

const MANIFEST_FILE = '.masterino-owned-skills.json';
const PREFIX = 'masterino-';
const EXCLUDE_LINE = '/.claude/skills/masterino-*/';
const SAFE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const toBytes = (value: string | Uint8Array): Uint8Array =>
  typeof value === 'string' ? encoder.encode(value) : value;
const toText = (value: string | Uint8Array): string =>
  typeof value === 'string' ? value : decoder.decode(value);
const equal = (left: string | Uint8Array, right: string | Uint8Array): boolean => {
  const a = toBytes(left);
  const b = toBytes(right);
  return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);
};
const resolveWithin = (root: string, ...segments: string[]): string => {
  const target = path.resolve(root, ...segments);
  const relative = path.relative(path.resolve(root), target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Skill materialization path escapes its target root.');
  }
  return target;
};
const normalizeRelative = (value: string): string => {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid relative skill path.');
  }
  return normalized;
};
const directoryName = (ref: MaterializableSkill): string => {
  for (const candidate of [ref.identifier, ref.name]) {
    if (SAFE_NAME.test(candidate)) return PREFIX + candidate;
  }
  throw new Error(`Skill ${ref.key} has no path-safe identifier or name.`);
};
const renderSkill = (ref: MaterializableSkill): string | undefined => {
  if (!ref.content) return;
  if (/^---\s*\n/.test(ref.content)) return ref.content;
  return `---\nname: ${JSON.stringify(ref.name)}\ndescription: ${JSON.stringify(ref.description)}\n---\n\n${ref.content}`;
};
const parseManifest = (value: string | Uint8Array | undefined): OwnershipManifest => {
  if (value === undefined) return { entries: {}, version: 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(toText(value));
  } catch {
    throw new Error('Masterino skill ownership manifest is invalid.');
  }
  const input = parsed as Partial<OwnershipManifest> | undefined;
  if (!input || input.version !== 1 || !input.entries || typeof input.entries !== 'object') {
    throw new Error('Masterino skill ownership manifest is invalid.');
  }
  const entries: Record<string, string> = {};
  for (const [name, key] of Object.entries(input.entries)) {
    if (!name.startsWith(PREFIX) || !SAFE_NAME.test(name.slice(PREFIX.length)) || !key) {
      throw new Error('Masterino skill ownership manifest is invalid.');
    }
    entries[name] = key;
  }
  return { entries, version: 1 };
};
const serializeManifest = (entries: Record<string, string>): string =>
  JSON.stringify(
    {
      entries: Object.fromEntries(
        Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
      ),
      version: 1,
    },
    null,
    2,
  ) + '\n';

/** Materializes only registry winners and only replaces directories it owns. */
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
        ? options.workspaceRoot && resolveWithin(options.workspaceRoot, '.claude', 'skills')
        : options.userSkillsRoot;
    if (!targetRoot) return { ...base, reason: 'workspace-required' };

    const manifestPath = resolveWithin(targetRoot, MANIFEST_FILE);
    let previous: OwnershipManifest;
    try {
      await this.assertNoSymlink(targetRoot);
      previous = parseManifest(await this.fs.readFile(manifestPath));
    } catch (error) {
      return {
        ...base,
        errors: [{ key: 'ownership-manifest', message: String((error as Error).message) }],
        status: 'unchanged',
        targetRoot,
      };
    }

    const plans: Array<{ directory: string; ref: MaterializableSkill; root: string }> = [];
    const seen = new Set<string>();
    for (const ref of options.registry.skills) {
      try {
        const directory = directoryName(ref);
        if (seen.has(directory))
          throw new Error(`Multiple registry skills resolve to ${directory}.`);
        seen.add(directory);
        plans.push({ directory, ref, root: resolveWithin(targetRoot, directory) });
      } catch (error) {
        base.errors.push({ key: ref.key, message: (error as Error).message });
      }
    }
    if (base.errors.length > 0) return { ...base, status: 'unchanged', targetRoot };

    for (const plan of plans) {
      await this.assertNoSymlink(plan.root);
      const entry = await this.fs.lstat(plan.root);
      if (entry && !Object.hasOwn(previous.entries, plan.directory)) {
        base.errors.push({
          key: plan.ref.key,
          message: `Refusing to replace foreign skill directory ${plan.directory}.`,
        });
      } else if (entry && !entry.isDirectory) {
        base.errors.push({ key: plan.ref.key, message: `${plan.directory} is not a directory.` });
      }
    }
    if (base.errors.length > 0) return { ...base, status: 'unchanged', targetRoot };

    await this.fs.mkdir(targetRoot);
    const nextEntries: Record<string, string> = {};
    for (const plan of plans) {
      try {
        const defaultSkill = renderSkill(plan.ref);
        const bundle =
          (await options.resolveBundle?.(plan.ref)) ??
          (defaultSkill ? { 'SKILL.md': defaultSkill } : undefined);
        if (!bundle?.['SKILL.md'])
          throw new Error('Skill content is unavailable for materialization.');
        await this.fs.mkdir(plan.root);
        for (const [relativePath, content] of Object.entries(bundle)) {
          const target = resolveWithin(plan.root, ...normalizeRelative(relativePath).split('/'));
          await this.assertNoSymlink(target);
          await this.fs.mkdir(path.dirname(target));
          const existing = await this.fs.readFile(target);
          if (existing !== undefined && equal(existing, content)) continue;
          await this.fs.writeFile(target, content);
          base.writes.push(target);
        }
        nextEntries[plan.directory] = plan.ref.key;
      } catch (error) {
        base.errors.push({ key: plan.ref.key, message: (error as Error).message });
        if (Object.hasOwn(previous.entries, plan.directory)) {
          nextEntries[plan.directory] = previous.entries[plan.directory];
        }
      }
    }

    for (const [directory, key] of Object.entries(previous.entries)) {
      if (seen.has(directory)) continue;
      const stale = resolveWithin(targetRoot, directory);
      try {
        await this.assertNoSymlink(stale);
        if (await this.fs.lstat(stale)) {
          await this.fs.removeDirectory(stale);
          base.removals.push(stale);
        }
      } catch (error) {
        base.errors.push({ key, message: (error as Error).message });
        nextEntries[directory] = key;
      }
    }

    const nextManifest = serializeManifest(nextEntries);
    const currentManifest = await this.fs.readFile(manifestPath);
    if (currentManifest === undefined || !equal(currentManifest, nextManifest)) {
      await this.fs.writeFile(manifestPath, nextManifest);
      base.writes.push(manifestPath);
    }

    if (mode === 'project' && options.workspaceRoot) {
      const excludePath =
        options.gitExcludePath ?? resolveWithin(options.workspaceRoot, '.git', 'info', 'exclude');
      await this.assertNoSymlink(excludePath);
      const current = await this.fs.readFile(excludePath);
      const lines = (current === undefined ? '' : toText(current)).split(/\r?\n/).filter(Boolean);
      if (!lines.includes(EXCLUDE_LINE)) {
        await this.fs.mkdir(path.dirname(excludePath));
        await this.fs.writeFile(excludePath, [...lines, EXCLUDE_LINE].join('\n') + '\n');
        base.writes.push(excludePath);
      }
    }

    return {
      ...base,
      status: base.writes.length > 0 || base.removals.length > 0 ? 'materialized' : 'unchanged',
      targetRoot,
    };
  }

  private async assertNoSymlink(target: string): Promise<void> {
    const root = path.parse(target).root;
    let current = root;
    for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if ((await this.fs.lstat(current))?.isSymbolicLink) {
        throw new Error(`Symbolic links are not allowed: ${current}`);
      }
    }
  }
}

export const nodeSkillMaterializationFs: SkillMaterializationFsAdapter = {
  lstat: async (target) => {
    const value = await lstat(target).catch(() => undefined);
    return value
      ? { isDirectory: value.isDirectory(), isSymbolicLink: value.isSymbolicLink() }
      : undefined;
  },
  mkdir: (target) => mkdir(target, { recursive: true }).then(() => {}),
  readFile: (target) => readFile(target).catch(() => undefined),
  removeDirectory: (target) => rm(target, { recursive: true }).then(() => {}),
  writeFile: (target, content) => writeFile(target, content).then(() => {}),
};

const resolveGitExcludePath = async (cwd: string): Promise<string> => {
  const dotGit = path.join(cwd, '.git');
  const value = await readFile(dotGit, 'utf8').catch(() => undefined);
  const gitDir = value
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('gitdir:'))
    ?.slice('gitdir:'.length)
    .trim();
  return gitDir
    ? path.join(path.resolve(cwd, gitDir), 'info', 'exclude')
    : path.join(dotGit, 'info', 'exclude');
};

/** Production device entry called before a heterogeneous CLI process is spawned. */
export const materializeSkillsForCli = async (input: {
  agentType: string;
  cwd: string;
  policy?: HeterogeneousSkillMaterializationMode;
  skills?: MaterializableSkill[];
}): Promise<SkillMaterializationResult> => {
  const mode = input.policy ?? 'off';
  if (mode === 'off') {
    return new HeterogeneousSkillMaterializer(nodeSkillMaterializationFs).materialize({
      cli: 'claude-code',
      registry: { policy: { materializeForHeteroCli: mode }, skills: input.skills ?? [] },
    });
  }

  const cli: HeterogeneousSkillCli | undefined =
    input.agentType === 'codex'
      ? 'codex'
      : input.agentType === 'claude-code' || input.agentType === 'claudeCode'
        ? 'claude-code'
        : undefined;
  if (!cli) {
    return {
      errors: [],
      mode,
      reason: 'unsupported-agent',
      removals: [],
      status: 'skipped',
      writes: [],
    };
  }
  if (cli === 'codex') {
    return new HeterogeneousSkillMaterializer(nodeSkillMaterializationFs).materialize({
      cli,
      registry: { policy: { materializeForHeteroCli: mode }, skills: input.skills ?? [] },
    });
  }

  // macOS commonly exposes /var as a system symlink. Canonicalize the trusted
  // roots before the materializer performs its component-by-component symlink
  // checks, while still rejecting symlinks created below those roots.
  const workspaceRoot = await realpath(input.cwd);
  const userHome = await realpath(os.homedir());
  return new HeterogeneousSkillMaterializer(nodeSkillMaterializationFs).materialize({
    cli,
    gitExcludePath: mode === 'project' ? await resolveGitExcludePath(workspaceRoot) : undefined,
    registry: { policy: { materializeForHeteroCli: mode }, skills: input.skills ?? [] },
    userSkillsRoot: path.join(userHome, '.claude', 'skills'),
    workspaceRoot,
  });
};
