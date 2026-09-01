import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type CloseExecutionContextResult,
  EXECUTION_CONTEXT_VERSION,
  type ExecutionContextRef,
  type ExecutionPackageManager,
  type ExecutionRuntime,
  type ExecutionRuntimePlan,
  type PreparedExecutionContext,
  type PrepareExecutionContextParams,
  type RuntimeCapability,
  type ShellEnvironmentPolicy,
} from '@lobechat/electron-client-ipc';

const execFileAsync = promisify(execFile);

const RUNTIME_TOOLS = ['node', 'bun', 'python'] as const;
const PACKAGE_MANAGER_TOOLS = ['npm', 'pnpm', 'yarn', 'bun', 'uv', 'pip'] as const;
const ALL_PREFLIGHT_TOOLS = [...new Set([...RUNTIME_TOOLS, ...PACKAGE_MANAGER_TOOLS])];

type PreflightTool = (typeof ALL_PREFLIGHT_TOOLS)[number];

export type ExecutionContextErrorCode =
  | 'CONTEXT_NOT_FOUND'
  | 'CONTEXT_VERSION_MISMATCH'
  | 'INVALID_WORKSPACE'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'WORKSPACE_UNAVAILABLE';

export class ExecutionContextError extends Error {
  constructor(
    public readonly code: ExecutionContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionContextError';
  }
}

interface ToolDetection {
  available: boolean;
  executablePath?: string;
  version?: string;
}

interface ExecutionContextManagerOptions {
  baseEnvironment?: () => NodeJS.ProcessEnv;
  detectTool?: (tool: PreflightTool, environment: Record<string, string>) => Promise<ToolDetection>;
  /** Allows Windows environment semantics to be covered on non-Windows CI. */
  environmentPlatform?: NodeJS.Platform;
  managedWorkspaceRoot: string;
  now?: () => Date;
  randomId?: () => string;
}

interface WorkspaceIdentity {
  dev: number;
  ino: number;
}

interface PrivateExecutionContext {
  capabilities: Record<PreflightTool, ToolDetection>;
  environment: Record<string, string>;
  receipt: PreparedExecutionContext;
  workspaceIdentity: WorkspaceIdentity;
}

interface CommandParams {
  command: string;
  cwd?: string;
  description?: string;
  env?: Record<string, string>;
  run_in_background?: boolean;
  timeout?: number;
}

interface ProjectSignals {
  lockfilePackageManager?: ExecutionPackageManager;
  lockfileRuntime?: ExecutionRuntime;
  packageManager?: ExecutionPackageManager;
  projectRuntime?: ExecutionRuntime;
}

const CORE_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
]);

const normalizeEnvironmentKey = (key: string, platform: NodeJS.Platform): string =>
  platform === 'win32' ? key.toUpperCase() : key;

const toStringEnvironment = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [normalizeEnvironmentKey(key, platform), value]),
  );

const isWithinRoot = (target: string, root: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizePackageManager = (value: unknown): ExecutionPackageManager | undefined => {
  if (typeof value !== 'string') return undefined;
  const name = value.split('@')[0] as ExecutionPackageManager;
  return PACKAGE_MANAGER_TOOLS.includes(name as (typeof PACKAGE_MANAGER_TOOLS)[number])
    ? name
    : undefined;
};

const capabilityOf = (detection: ToolDetection | undefined): RuntimeCapability => ({
  available: detection?.available === true,
  ...(detection?.version ? { version: detection.version } : {}),
});

const findNearestExistingPath = async (target: string): Promise<string> => {
  let candidate = target;
  while (true) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
};

const executableCandidates = (tool: PreflightTool, platform: NodeJS.Platform): string[] => {
  if (tool === 'python') {
    return platform === 'win32' ? ['python.exe', 'py.exe'] : ['python3', 'python'];
  }
  if (platform !== 'win32') return [tool];
  return [`${tool}.exe`, `${tool}.cmd`, `${tool}.bat`, tool];
};

const detectToolOnPath = async (
  tool: PreflightTool,
  environment: Record<string, string>,
  platform: NodeJS.Platform,
): Promise<ToolDetection> => {
  const pathValue = environment.PATH ?? '';
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  for (const directory of pathValue.split(platformPath.delimiter).filter(Boolean)) {
    for (const executable of executableCandidates(tool, platform)) {
      const executablePath = platformPath.join(directory, executable);
      try {
        await access(executablePath, platform === 'win32' ? constants.F_OK : constants.X_OK);
        const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], {
          env: environment,
          // npm/pnpm/yarn are commonly .cmd shims on Windows. Node cannot
          // execFile them directly, so let ComSpec execute only those shims.
          shell:
            platform === 'win32' &&
            (executablePath.toLowerCase().endsWith('.cmd') ||
              executablePath.toLowerCase().endsWith('.bat')),
          timeout: 3000,
          windowsHide: true,
        });
        const version = `${stdout || stderr}`.trim().split(/\r?\n/)[0] || undefined;
        return { available: true, executablePath, version };
      } catch {
        // Keep searching. A PATH entry can contain a broken shim.
      }
    }
  }
  return { available: false };
};

export class ExecutionContextManager {
  private readonly contexts = new Map<string, PrivateExecutionContext>();
  private readonly baseEnvironment: () => NodeJS.ProcessEnv;
  private readonly detectTool: NonNullable<ExecutionContextManagerOptions['detectTool']>;
  private readonly environmentPlatform: NodeJS.Platform;
  private readonly managedWorkspaceRoot: string;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(options: ExecutionContextManagerOptions) {
    this.baseEnvironment = options.baseEnvironment ?? (() => process.env);
    this.environmentPlatform = options.environmentPlatform ?? process.platform;
    this.detectTool =
      options.detectTool ??
      ((tool, environment) => detectToolOnPath(tool, environment, this.environmentPlatform));
    this.managedWorkspaceRoot = options.managedWorkspaceRoot;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  async prepare(params: PrepareExecutionContextParams): Promise<PreparedExecutionContext> {
    const workspace = await this.resolveWorkspace(params);
    const { environment, receipt: environmentReceipt } = this.resolveEnvironment(
      params.environmentPolicy,
    );
    const capabilities = await this.runPreflight(environment);
    const projectSignals = await this.readProjectSignals(workspace.realPath);
    const runtimePlan = this.planRuntime(params, projectSignals, capabilities);
    const workspaceStat = await stat(workspace.realPath);
    const contextId = this.randomId();
    const frozenEnvironmentReceipt = Object.freeze({
      ...environmentReceipt,
      overriddenKeys: Object.freeze([...environmentReceipt.overriddenKeys]) as unknown as string[],
      removedKeys: Object.freeze([...environmentReceipt.removedKeys]) as unknown as string[],
    });
    const frozenRuntimePlan = Object.freeze({
      ...runtimePlan,
      ...(runtimePlan.packageManagerCapability
        ? {
            packageManagerCapability: Object.freeze({
              ...runtimePlan.packageManagerCapability,
            }),
          }
        : {}),
      runtimeCapability: Object.freeze({ ...runtimePlan.runtimeCapability }),
    });
    const receipt: PreparedExecutionContext = Object.freeze({
      createdAt: this.now().toISOString(),
      environment: frozenEnvironmentReceipt,
      ref: Object.freeze({ contextId, version: EXECUTION_CONTEXT_VERSION }),
      runtimePlan: frozenRuntimePlan,
      workspace: Object.freeze({
        ...workspace,
        writableRoots: Object.freeze([...workspace.writableRoots]) as unknown as string[],
      }),
    });

    this.contexts.set(contextId, {
      capabilities,
      environment: Object.freeze({ ...environment }),
      receipt,
      workspaceIdentity: { dev: workspaceStat.dev, ino: workspaceStat.ino },
    });

    return receipt;
  }

  async inspect(ref: ExecutionContextRef): Promise<PreparedExecutionContext> {
    return this.getContext(ref).receipt;
  }

  async close(ref: ExecutionContextRef): Promise<CloseExecutionContextResult> {
    this.assertVersion(ref);
    return { closed: this.contexts.delete(ref.contextId) };
  }

  async resolveCommand(ref: ExecutionContextRef, params: CommandParams): Promise<CommandParams> {
    const context = this.getContext(ref);
    await this.assertWorkspaceAvailable(context);
    return {
      command: params.command,
      ...(params.description ? { description: params.description } : {}),
      ...(params.run_in_background !== undefined
        ? { run_in_background: params.run_in_background }
        : {}),
      ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
      cwd: context.receipt.workspace.realPath,
      env: { ...context.environment },
    };
  }

  async resolvePath(
    ref: ExecutionContextRef,
    targetPath: string,
    _access: 'read' | 'write',
  ): Promise<string> {
    const context = this.getContext(ref);
    await this.assertWorkspaceAvailable(context);
    const candidate = path.resolve(context.receipt.workspace.realPath, targetPath);
    const nearestExisting = await findNearestExistingPath(candidate);
    const nearestRealPath = await realpath(nearestExisting);
    const projectedPath = path.join(nearestRealPath, path.relative(nearestExisting, candidate));

    if (
      !context.receipt.workspace.writableRoots.some((root) => isWithinRoot(projectedPath, root))
    ) {
      throw new ExecutionContextError(
        'PATH_OUTSIDE_WORKSPACE',
        `Path is outside the execution workspace: ${targetPath}`,
      );
    }

    return projectedPath;
  }

  private assertVersion(ref: ExecutionContextRef) {
    if (ref.version !== EXECUTION_CONTEXT_VERSION) {
      throw new ExecutionContextError(
        'CONTEXT_VERSION_MISMATCH',
        `Unsupported execution context version: ${ref.version}`,
      );
    }
  }

  private getContext(ref: ExecutionContextRef): PrivateExecutionContext {
    this.assertVersion(ref);
    const context = this.contexts.get(ref.contextId);
    if (!context) {
      throw new ExecutionContextError(
        'CONTEXT_NOT_FOUND',
        `Execution context is unavailable: ${ref.contextId}`,
      );
    }
    return context;
  }

  private async assertWorkspaceAvailable(context: PrivateExecutionContext) {
    try {
      const currentRealPath = await realpath(context.receipt.workspace.realPath);
      const currentStat = await stat(currentRealPath);
      if (
        currentRealPath !== context.receipt.workspace.realPath ||
        currentStat.dev !== context.workspaceIdentity.dev ||
        currentStat.ino !== context.workspaceIdentity.ino
      ) {
        throw new Error('Workspace identity changed');
      }
    } catch {
      throw new ExecutionContextError(
        'WORKSPACE_UNAVAILABLE',
        `Execution workspace is no longer available: ${context.receipt.workspace.realPath}`,
      );
    }
  }

  private resolveEnvironment(policy: ShellEnvironmentPolicy | undefined): {
    environment: Record<string, string>;
    receipt: PreparedExecutionContext['environment'];
  } {
    const inherit = policy?.inherit ?? 'all';
    const base = toStringEnvironment(this.baseEnvironment(), this.environmentPlatform);
    let environment: Record<string, string>;

    if (inherit === 'all') {
      environment = { ...base };
    } else {
      const retained = new Set([
        ...(inherit === 'core' ? CORE_ENVIRONMENT_KEYS : []),
        ...(policy?.include ?? []).map((key) =>
          normalizeEnvironmentKey(key, this.environmentPlatform),
        ),
      ]);
      environment = Object.fromEntries(Object.entries(base).filter(([key]) => retained.has(key)));
    }

    const excludedKeys = (policy?.exclude ?? []).map((key) =>
      normalizeEnvironmentKey(key, this.environmentPlatform),
    );
    const overriddenEntries = Object.entries(policy?.set ?? {}).map(([key, value]) => [
      normalizeEnvironmentKey(key, this.environmentPlatform),
      value,
    ]);
    for (const key of excludedKeys) delete environment[key];
    Object.assign(environment, Object.fromEntries(overriddenEntries));

    return {
      environment,
      receipt: {
        inherited: inherit,
        overriddenKeys: overriddenEntries.map(([key]) => key).sort(),
        pathEntryCount: (environment.PATH ?? '')
          .split(this.environmentPlatform === 'win32' ? path.win32.delimiter : path.posix.delimiter)
          .filter(Boolean).length,
        removedKeys: excludedKeys.sort(),
      },
    };
  }

  private async resolveWorkspace(params: PrepareExecutionContextParams) {
    const requested = params.requestedWorkingDirectory?.trim();
    let source: 'managed' | 'selected';
    let candidate: string;

    if (requested) {
      if (!path.isAbsolute(requested)) {
        throw new ExecutionContextError(
          'INVALID_WORKSPACE',
          `Execution workspace must be absolute: ${requested}`,
        );
      }
      candidate = requested;
      source = 'selected';
    } else {
      // Existing Topics keep one stable workspace. Before a Topic id exists,
      // isolate concurrent new-topic turns by operation id; the created Topic
      // then persists that realPath in metadata for later turns.
      const stableKey = params.topicId || params.operationId || params.agentId || 'unscoped';
      const directoryName = createHash('sha256').update(stableKey).digest('hex').slice(0, 24);
      candidate = path.join(this.managedWorkspaceRoot, directoryName);
      await mkdir(candidate, { recursive: true });
      source = 'managed';
    }

    try {
      const candidateStat = await stat(candidate);
      if (!candidateStat.isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ExecutionContextError(
        'INVALID_WORKSPACE',
        `Execution workspace does not exist or is not a directory: ${candidate}`,
      );
    }

    const canonicalWorkspace = await realpath(candidate);
    const requestedRoots = params.requestedWritableRoots ?? [];
    const writableRoots = [canonicalWorkspace];
    for (const root of requestedRoots) {
      if (!path.isAbsolute(root)) {
        throw new ExecutionContextError(
          'INVALID_WORKSPACE',
          `Writable root must be absolute: ${root}`,
        );
      }
      const rootStat = await stat(root).catch(() => undefined);
      if (!rootStat?.isDirectory()) {
        throw new ExecutionContextError(
          'INVALID_WORKSPACE',
          `Writable root does not exist or is not a directory: ${root}`,
        );
      }
      writableRoots.push(await realpath(root));
    }

    return {
      realPath: canonicalWorkspace,
      source,
      writableRoots: [...new Set(writableRoots)],
    };
  }

  private async runPreflight(
    environment: Record<string, string>,
  ): Promise<Record<PreflightTool, ToolDetection>> {
    const entries = await Promise.all(
      ALL_PREFLIGHT_TOOLS.map(
        async (tool) => [tool, await this.detectTool(tool, environment)] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<PreflightTool, ToolDetection>;
  }

  private async readProjectSignals(workspace: string): Promise<ProjectSignals> {
    const signals: ProjectSignals = {};
    try {
      const packageJson = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
      signals.packageManager = normalizePackageManager(packageJson.packageManager);
      if (typeof packageJson.engines?.bun === 'string') signals.projectRuntime = 'bun';
      else if (typeof packageJson.engines?.node === 'string') signals.projectRuntime = 'node';
    } catch {
      // package.json is optional. Invalid JSON is ignored as an absent project signal.
    }

    const exists = async (name: string) =>
      access(path.join(workspace, name), constants.F_OK).then(
        () => true,
        () => false,
      );
    const [bunLock, pnpmLock, npmLock, yarnLock, uvLock, pyproject, bunConfig] = await Promise.all([
      Promise.all([exists('bun.lock'), exists('bun.lockb')]).then((values) => values.some(Boolean)),
      exists('pnpm-lock.yaml'),
      exists('package-lock.json'),
      exists('yarn.lock'),
      exists('uv.lock'),
      exists('pyproject.toml'),
      exists('bunfig.toml'),
    ]);

    if (!signals.projectRuntime) {
      if (bunConfig) signals.projectRuntime = 'bun';
      else if (pyproject) signals.projectRuntime = 'python';
    }
    if (bunLock) {
      signals.lockfilePackageManager = 'bun';
    } else if (pnpmLock) {
      signals.lockfilePackageManager = 'pnpm';
      signals.lockfileRuntime = 'node';
    } else if (npmLock) {
      signals.lockfilePackageManager = 'npm';
      signals.lockfileRuntime = 'node';
    } else if (yarnLock) {
      signals.lockfilePackageManager = 'yarn';
      signals.lockfileRuntime = 'node';
    } else if (uvLock) {
      signals.lockfilePackageManager = 'uv';
      signals.lockfileRuntime = 'python';
    }

    return signals;
  }

  private planRuntime(
    params: PrepareExecutionContextParams,
    signals: ProjectSignals,
    capabilities: Record<PreflightTool, ToolDetection>,
  ): ExecutionRuntimePlan {
    const workload = params.workload ?? { kind: 'unknown' as const };
    let runtime: ExecutionRuntime;
    let runtimeSource: ExecutionRuntimePlan['runtimeSource'];

    if (workload.runtime) {
      runtime = workload.runtime;
      runtimeSource = 'workload';
    } else if (signals.projectRuntime) {
      runtime = signals.projectRuntime;
      runtimeSource = 'project';
    } else if (signals.lockfileRuntime) {
      runtime = signals.lockfileRuntime;
      runtimeSource = 'lockfile';
    } else if (workload.bunCompatible && workload.masterinoOwned) {
      runtime = 'bun';
      runtimeSource = 'compatibility';
    } else if (workload.kind === 'python') {
      runtime = 'python';
      runtimeSource = 'default';
    } else if (workload.kind === 'shell') {
      runtime = 'shell';
      runtimeSource = 'default';
    } else {
      runtime = 'node';
      runtimeSource = 'default';
    }

    let packageManager: ExecutionPackageManager | undefined;
    let packageManagerSource: ExecutionRuntimePlan['packageManagerSource'];
    if (workload.packageManager) {
      packageManager = workload.packageManager;
      packageManagerSource = 'workload';
    } else if (signals.packageManager) {
      packageManager = signals.packageManager;
      packageManagerSource = 'project';
    } else if (signals.lockfilePackageManager) {
      packageManager = signals.lockfilePackageManager;
      packageManagerSource = 'lockfile';
    } else if (runtime === 'node') {
      packageManager = 'npm';
      packageManagerSource = 'default';
    } else if (runtime === 'bun') {
      packageManager = 'bun';
      packageManagerSource = 'default';
    } else if (runtime === 'python') {
      packageManager = 'uv';
      packageManagerSource = 'default';
    }

    const runtimeCapability =
      runtime === 'shell' ? { available: true } : capabilityOf(capabilities[runtime]);
    const packageManagerCapability = packageManager
      ? capabilityOf(capabilities[packageManager])
      : undefined;
    const status =
      runtime === 'shell'
        ? 'not_required'
        : runtimeCapability.available &&
            (!packageManagerCapability || packageManagerCapability.available)
          ? 'ready'
          : 'missing';

    return {
      ...(packageManager ? { packageManager } : {}),
      ...(packageManagerCapability ? { packageManagerCapability } : {}),
      ...(packageManagerSource ? { packageManagerSource } : {}),
      runtime,
      runtimeCapability,
      runtimeSource,
      status,
    };
  }
}
