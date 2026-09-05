import type { ExecutionEnvLayer } from '@lobechat/types/src/executionContext';

/**
 * Reserved-key lists live in `@lobechat/const/executionEnv` so the settings UI can warn with the
 * exact policy this service enforces. Re-exported here to keep the service surface stable.
 */
export {
  ENV_KEY_PATTERN,
  RUNTIME_RESERVED_ENV_KEYS,
  RUNTIME_RESERVED_ENV_PREFIXES,
  SECURITY_SENSITIVE_ENV_KEYS,
} from '@lobechat/const/executionEnv';

/** Later layers override earlier layers. Keep all execution channels on this order. */
export const EXECUTION_ENV_LAYER_ORDER = [
  'host',
  'user',
  'workspace',
  'topic',
  'agent',
  'call',
] as const satisfies readonly ExecutionEnvLayer[];
