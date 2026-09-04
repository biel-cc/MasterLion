import { createHash } from 'node:crypto';

import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:ExecutionEnvSrv');
const CACHE_TTL_MS = 60_000;

export interface ExecutionEnvRef {
  agentId: string;
  topicId?: string;
  workspaceId?: string;
}

interface CacheEntry {
  expiresAt: number;
  values: Record<string, string>;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string');

export default class ExecutionEnvService extends ServiceModule {
  private readonly cache = new Map<string, CacheEntry>();

  resolve = async (ref: ExecutionEnvRef): Promise<Record<string, string>> => {
    try {
      const remote = this.app.getController(RemoteServerConfigCtr);
      if (!remote) throw new Error('Remote server controller is unavailable');
      const [serverUrl, token] = await Promise.all([
        remote.getRemoteServerUrl(),
        remote.getAccessToken(),
      ]);
      if (!serverUrl || !token) throw new Error('Desktop authentication is unavailable');

      // Authentication is part of the cache scope. Resolve it before reading
      // cached plaintext so logout, account changes and server switches can
      // never reuse values from the preceding desktop session.
      const authScope = createHash('sha256').update(`${serverUrl}\0${token}`).digest('hex');
      const key = JSON.stringify([
        authScope,
        ref.agentId,
        ref.topicId ?? '',
        ref.workspaceId ?? '',
      ]);
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return { ...cached.values };

      const endpoint = `${serverUrl.replace(/\/+$/, '')}/trpc/lambda/projectWorkspace.getResolvedEnv`;
      const response = await fetch(endpoint, {
        body: JSON.stringify({ json: ref }),
        headers: {
          'Content-Type': 'application/json',
          'Oidc-Auth': token,
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`Environment endpoint returned ${response.status}`);

      const payload = (await response.json()) as {
        result?: { data?: { json?: unknown } | unknown };
      };
      const data =
        payload.result?.data &&
        typeof payload.result.data === 'object' &&
        'json' in payload.result.data
          ? payload.result.data.json
          : payload.result?.data;
      if (!isStringRecord(data)) throw new Error('Environment endpoint returned invalid data');

      const values = { ...data };
      this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, values });
      return { ...values };
    } catch (error) {
      // Never log values or response bodies. An empty environment is the
      // compatibility fallback for old/unavailable servers.
      logger.warn('Unable to resolve managed execution environment:', error);
      return {};
    }
  };
}
