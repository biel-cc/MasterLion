import {
  ENV_KEY_PATTERN,
  getExecutionEnvKeyRestriction,
  RUNTIME_RESERVED_ENV_KEYS,
  SECURITY_SENSITIVE_ENV_KEYS,
} from '@lobechat/const/executionEnv';

/** Host credentials that must never leak into an agent child implicitly. */
export const HOST_ENV_BLOCKLIST = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

export const RUNTIME_PROTECTED_ENV_KEYS = new Set([
  ...RUNTIME_RESERVED_ENV_KEYS,
  ...SECURITY_SENSITIVE_ENV_KEYS,
]);

export interface ComposeChildProcessEnvInput {
  /** Environment owned by the process host. */
  hostEnv: Readonly<Record<string, string | undefined>>;
  /** Login-shell PATH discovered by the device. */
  loginShellPath?: string;
  /** Resolved workspace/topic/agent/call environment. */
  resolvedEnv?: Readonly<Record<string, string>>;
  /** Trusted values authored for this operation, such as the Masterino CLI JWT. */
  runtimeEnv?: Readonly<Record<string, string>>;
}

export const isRuntimeProtectedEnvKey = (key: string): boolean => {
  return getExecutionEnvKeyRestriction(key.toUpperCase()) !== undefined;
};

const assertValidKey = (key: string): void => {
  if (!ENV_KEY_PATTERN.test(key)) throw new Error('Invalid environment variable name.');
};

/**
 * Compose a child environment without mutating inputs. Resolved values can replace ordinary host
 * variables, while process identity, loader hooks, and operation credentials remain host-owned.
 */
export const composeChildProcessEnv = ({
  hostEnv,
  resolvedEnv,
  runtimeEnv,
  loginShellPath,
}: ComposeChildProcessEnvInput): Record<string, string> => {
  const result: Record<string, string> = {};
  const blockedHostKeys = new Set<string>(HOST_ENV_BLOCKLIST);

  for (const [key, value] of Object.entries(hostEnv)) {
    if (typeof value !== 'string') continue;
    if (blockedHostKeys.has(key.toUpperCase())) continue;
    result[key] = value;
  }

  if (loginShellPath) result.PATH = loginShellPath;

  for (const [key, value] of Object.entries(resolvedEnv ?? {})) {
    assertValidKey(key);
    if (!isRuntimeProtectedEnvKey(key)) result[key] = value;
  }

  for (const [key, value] of Object.entries(runtimeEnv ?? {})) {
    assertValidKey(key);
    result[key] = value;
  }

  return result;
};

export const buildChildProcessEnv = composeChildProcessEnv;

export * from './loginShellPath';
export * from './workspaceEnvFiles';
