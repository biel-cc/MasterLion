const ENV_KEY_PATTERN = /^[A-Z_]\w*$/i;

export const RUNTIME_PROTECTED_ENV_KEYS = new Set([
  'BASH_ENV',
  'BUN_OPTIONS',
  'CDPATH',
  'COMSPEC',
  'ENV',
  'GIT_ASKPASS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GLOBIGNORE',
  'HOME',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'LOGNAME',
  'NODE_OPTIONS',
  'OLDPWD',
  'PATH',
  'PATHEXT',
  'PERL5OPT',
  'PS4',
  'PWD',
  'PYTHONHOME',
  'PYTHONPATH',
  'RUBYOPT',
  'SHELL',
  'SHELLOPTS',
  'SSH_ASKPASS',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'WINDIR',
]);

const RUNTIME_PROTECTED_ENV_PREFIXES = ['DYLD_', 'LOBEHUB_', 'MASTERINO_'] as const;

export interface ComposeChildProcessEnvInput {
  /** Environment owned by the process host. */
  hostEnv: Readonly<Record<string, string | undefined>>;
  /** Resolved workspace/topic/agent/call environment. */
  resolvedEnv?: Readonly<Record<string, string>>;
  /** Trusted values authored for this operation, such as the Masterino CLI JWT. */
  runtimeEnv?: Readonly<Record<string, string>>;
}

export const isRuntimeProtectedEnvKey = (key: string): boolean => {
  const normalized = key.toUpperCase();
  return (
    RUNTIME_PROTECTED_ENV_KEYS.has(normalized) ||
    RUNTIME_PROTECTED_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
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
}: ComposeChildProcessEnvInput): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(hostEnv)) {
    if (typeof value !== 'string') continue;
    result[key] = value;
  }

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
