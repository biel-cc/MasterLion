import type { ExecutionEnvLayer } from '@lobechat/types/src/executionContext';

/** Later layers override earlier layers. Keep all execution channels on this order. */
export const EXECUTION_ENV_LAYER_ORDER = [
  'host',
  'user',
  'workspace',
  'topic',
  'agent',
  'call',
] as const satisfies readonly ExecutionEnvLayer[];

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

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
