/**
 * Single source of truth for which environment variable names a user may configure.
 *
 * The server enforces this policy at every write boundary; the settings UI imports the same
 * module so it can warn before a save round-trip. Keep the lists here — a second copy in the
 * client would silently drift from what the runtime actually rejects.
 */

/** Process identity and command lookup are owned by the runtime that starts the child. */
export const RUNTIME_RESERVED_ENV_KEYS = new Set([
  'COMSPEC',
  'HOME',
  'LOGNAME',
  'OLDPWD',
  'PATH',
  'PATHEXT',
  'PWD',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'WINDIR',
]);

/** Variables with loader, interpreter, shell, or credential-injection side effects. */
export const SECURITY_SENSITIVE_ENV_KEYS = new Set([
  'BASH_ENV',
  'BUN_OPTIONS',
  'CDPATH',
  'ENV',
  'GIT_ASKPASS',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GLOBIGNORE',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'PERL5OPT',
  'PS4',
  'PYTHONHOME',
  'PYTHONPATH',
  'RUBYOPT',
  'SHELLOPTS',
  'SSH_ASKPASS',
]);

/** These namespaces are populated by Masterino for a particular runtime or operation. */
export const RUNTIME_RESERVED_ENV_PREFIXES = ['DYLD_', 'LOBEHUB_', 'MASTERINO_'] as const;

export const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export type ExecutionEnvKeyRestriction = 'invalid' | 'reserved' | 'security-sensitive';

const normalizeKey = (key: string) => key.toUpperCase();

/** `undefined` means the key is configurable in every non-host layer. */
export const getExecutionEnvKeyRestriction = (
  key: string,
): ExecutionEnvKeyRestriction | undefined => {
  if (!ENV_KEY_PATTERN.test(key)) return 'invalid';

  const normalized = normalizeKey(key);
  if (SECURITY_SENSITIVE_ENV_KEYS.has(normalized)) return 'security-sensitive';
  if (
    RUNTIME_RESERVED_ENV_KEYS.has(normalized) ||
    RUNTIME_RESERVED_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return 'reserved';
  }

  return undefined;
};
