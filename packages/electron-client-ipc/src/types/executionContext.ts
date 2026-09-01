export const EXECUTION_CONTEXT_VERSION = 1 as const;

export type ExecutionRuntime = 'bun' | 'node' | 'python' | 'shell';
export type ExecutionPackageManager = 'bun' | 'npm' | 'pip' | 'pnpm' | 'uv' | 'yarn';

export interface ExecutionContextRef {
  contextId: string;
  version: typeof EXECUTION_CONTEXT_VERSION;
}

/** Main-process execution reference attached by agent-only renderer calls. */
export type ExecutionScoped<T> = T & { executionContext?: ExecutionContextRef };

export interface ExecutionWorkload {
  /** Bun may only be selected as a compatibility fallback when this is explicit. */
  bunCompatible?: boolean;
  /** Workload category used by the planner when no runtime is declared. */
  kind: 'javascript' | 'python' | 'shell' | 'skill' | 'unknown';
  /** Masterino-owned skills may prefer the managed Bun adapter once it exists. */
  masterinoOwned?: boolean;
  /** Package manager intent is independent from runtime intent. */
  packageManager?: ExecutionPackageManager;
  /** Highest-priority explicit runtime declaration. */
  runtime?: ExecutionRuntime;
}

export interface ShellEnvironmentPolicy {
  /** Exact variable names removed after inheritance. */
  exclude?: string[];
  /** Exact variable names retained when `inherit` is `none`. */
  include?: string[];
  /** Variables copied from the Electron main process before filtering. */
  inherit?: 'all' | 'core' | 'none';
  /** Local-only overrides. Values are never included in the public snapshot. */
  set?: Record<string, string>;
}

export interface PrepareExecutionContextParams {
  agentId?: string;
  environmentPolicy?: ShellEnvironmentPolicy;
  operationId?: string;
  requestedWorkingDirectory?: string | null;
  requestedWritableRoots?: string[];
  topicId?: string | null;
  workload?: ExecutionWorkload;
}

export interface RuntimeCapability {
  available: boolean;
  version?: string;
}

export interface ExecutionRuntimePlan {
  packageManager?: ExecutionPackageManager;
  packageManagerCapability?: RuntimeCapability;
  packageManagerSource?: 'default' | 'lockfile' | 'project' | 'workload';
  runtime: ExecutionRuntime;
  runtimeCapability: RuntimeCapability;
  runtimeSource: 'compatibility' | 'default' | 'lockfile' | 'project' | 'workload';
  status: 'missing' | 'not_required' | 'ready';
}

export interface ExecutionEnvironmentReceipt {
  inherited: NonNullable<ShellEnvironmentPolicy['inherit']>;
  overriddenKeys: string[];
  pathEntryCount: number;
  removedKeys: string[];
}

export interface ExecutionWorkspaceReceipt {
  /** Canonical local path used by prompt, audit, files, and shell. */
  realPath: string;
  source: 'managed' | 'selected';
  writableRoots: string[];
}

/**
 * Safe, immutable receipt shared across renderer/server call paths. It deliberately
 * excludes resolved environment values and executable paths.
 */
export interface PreparedExecutionContext {
  createdAt: string;
  environment: ExecutionEnvironmentReceipt;
  ref: ExecutionContextRef;
  runtimePlan: ExecutionRuntimePlan;
  workspace: ExecutionWorkspaceReceipt;
}

export interface InspectExecutionContextParams {
  ref: ExecutionContextRef;
}

export interface CloseExecutionContextParams {
  ref: ExecutionContextRef;
}

export interface CloseExecutionContextResult {
  closed: boolean;
}
