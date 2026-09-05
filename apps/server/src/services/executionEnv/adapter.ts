import type {
  ExecutionEnv,
  ExecutionEnvAdapter,
  ExecutionEnvSummary,
  ResolveExecutionEnvRequest,
} from '@lobechat/types/src/executionContext';

import { EXECUTION_ENV_LAYER_ORDER } from './constants';
import { ExecutionEnvError } from './errors';
import type {
  BrowserExecutionEnvEntry,
  ExecutionEnvAdapterDependencies,
  ExecutionEnvLayerRecord,
} from './types';
import { canExecutionEnvLayerSetKey } from './validation';

const assertRequest = (request: ResolveExecutionEnvRequest): void => {
  if (!request.agentId?.trim() || !request.operationId?.trim() || !request.userId?.trim()) {
    throw new ExecutionEnvError(
      'INVALID_REQUEST',
      'Execution environment resolution requires an agent, operation, and user.',
    );
  }
};

const assertLayerRecord = (record: ExecutionEnvLayerRecord, key: string): void => {
  const entry = record[key];
  if (!entry || typeof entry.secret !== 'boolean' || typeof entry.value !== 'string') {
    throw new ExecutionEnvError(
      'LOAD_FAILED',
      `Execution environment storage returned an invalid entry for key: ${key}`,
    );
  }
};

export const summarizeExecutionEnv = (env: ExecutionEnv): ExecutionEnvSummary => ({
  keys: Object.keys(env.values).sort(),
  secretKeys: env.secretKeys.filter((key) => key in env.values).sort(),
});

export const toBrowserExecutionEnv = (env: ExecutionEnv): BrowserExecutionEnvEntry[] => {
  const summary = summarizeExecutionEnv(env);
  const secretKeys = new Set(summary.secretKeys);
  return summary.keys.map((key) => ({ key, secret: secretKeys.has(key) }));
};

export const projectExecutionEnvForBrowser = toBrowserExecutionEnv;

/**
 * Server-only adapter. Storage rows are loaded once per operation and secret payloads are
 * decrypted only while producing the resolved execution environment.
 */
export const createExecutionEnvAdapter = (
  dependencies: ExecutionEnvAdapterDependencies,
): ExecutionEnvAdapter => ({
  resolve: async (request) => {
    assertRequest(request);

    let records: (ExecutionEnvLayerRecord | undefined)[];
    try {
      records = await Promise.all(
        EXECUTION_ENV_LAYER_ORDER.map((layer) => dependencies.loadLayer(layer, request)),
      );
    } catch {
      throw new ExecutionEnvError('LOAD_FAILED', 'Unable to load the execution environment.');
    }

    const winningEntries: Record<
      string,
      { entry: ExecutionEnvLayerRecord[string]; layer: (typeof EXECUTION_ENV_LAYER_ORDER)[number] }
    > = {};

    for (const [index, layer] of EXECUTION_ENV_LAYER_ORDER.entries()) {
      const record = records[index];
      if (!record) continue;

      for (const key of Object.keys(record).sort()) {
        if (!canExecutionEnvLayerSetKey(layer, key)) continue;
        assertLayerRecord(record, key);
        winningEntries[key] = { entry: record[key], layer };
      }
    }

    const secretKeys: string[] = [];
    const sources: ExecutionEnv['sources'] = {};
    const values: ExecutionEnv['values'] = {};

    for (const key of Object.keys(winningEntries).sort()) {
      const { entry, layer } = winningEntries[key];
      let value = entry.value;
      if (entry.secret) {
        try {
          value = await dependencies.decryptSecret({
            encryptedValue: entry.value,
            key,
            layer,
            request,
          });
        } catch {
          throw new ExecutionEnvError(
            'DECRYPT_FAILED',
            `Unable to decrypt execution environment key: ${key}`,
          );
        }
        secretKeys.push(key);
      }

      values[key] = value;
      sources[key] = layer;
    }

    return { secretKeys, sources, values };
  },
  summarize: summarizeExecutionEnv,
});
