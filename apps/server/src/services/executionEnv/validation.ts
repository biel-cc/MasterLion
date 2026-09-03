import type { ExecutionEnvLayer } from '@lobechat/types/src/executionContext';

import {
  ENV_KEY_PATTERN,
  RUNTIME_RESERVED_ENV_KEYS,
  RUNTIME_RESERVED_ENV_PREFIXES,
  SECURITY_SENSITIVE_ENV_KEYS,
} from './constants';
import { ExecutionEnvError } from './errors';

export type ExecutionEnvKeyRestriction = 'invalid' | 'reserved' | 'security-sensitive';

const normalizeKey = (key: string) => key.toUpperCase();

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

export const isValidExecutionEnvKey = (key: string): boolean => ENV_KEY_PATTERN.test(key);

export const isReservedExecutionEnvKey = (key: string): boolean => {
  const restriction = getExecutionEnvKeyRestriction(key);
  return restriction === 'reserved' || restriction === 'security-sensitive';
};

export const assertValidExecutionEnvKey = (key: string): void => {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new ExecutionEnvError('INVALID_ENV_KEY', 'Invalid environment variable name.');
  }
};

/** Host values are observed, while configurable layers cannot replace runtime-owned keys. */
export const canExecutionEnvLayerSetKey = (layer: ExecutionEnvLayer, key: string): boolean => {
  assertValidExecutionEnvKey(key);
  return layer === 'host' || getExecutionEnvKeyRestriction(key) === undefined;
};

export const assertConfigurableExecutionEnvKey = (key: string): void => {
  assertValidExecutionEnvKey(key);
  const restriction = getExecutionEnvKeyRestriction(key);
  if (restriction) {
    throw new ExecutionEnvError(
      'RESERVED_ENV_KEY',
      `Environment variable is managed by the execution runtime: ${key}`,
    );
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate both current and legacy agent-env locations at every write boundary. */
export const assertConfigurableAgentExecutionEnv = (config: unknown): void => {
  if (!isRecord(config) || config.agencyConfig === undefined) return;
  if (!isRecord(config.agencyConfig)) {
    throw new ExecutionEnvError('INVALID_ENV_KEY', 'Invalid agent environment.');
  }

  const provider = isRecord(config.agencyConfig.heterogeneousProvider)
    ? config.agencyConfig.heterogeneousProvider
    : undefined;

  for (const env of [config.agencyConfig.env, provider?.env]) {
    if (env === undefined) continue;
    if (!isRecord(env) || Object.values(env).some((value) => typeof value !== 'string')) {
      throw new ExecutionEnvError('INVALID_ENV_KEY', 'Invalid agent environment.');
    }
    for (const key of Object.keys(env)) assertConfigurableExecutionEnvKey(key);
  }
};
