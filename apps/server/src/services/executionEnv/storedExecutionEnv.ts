import type { LobeAgentAgencyConfig } from '@lobechat/types/src/agent/agencyConfig';
import type { ExecutionEnv, ResolveExecutionEnvRequest } from '@lobechat/types/src/executionContext';
import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';

import { createExecutionEnvAdapter } from './adapter';

export interface ResolveStoredExecutionEnvInput extends ResolveExecutionEnvRequest {
  agentEnv?: Record<string, string>;
}

export interface StoredExecutionEnvDependencies {
  /** Decrypts one server-persisted value. Values never leave this server-side service. */
  decrypt: (encryptedValue: string) => Promise<string>;
  loadUserEnv: (userId: string) => Promise<ProjectWorkspaceEnvRecord | undefined>;
  loadWorkspaceEnv: (
    workspaceId: string,
    userId: string,
  ) => Promise<ProjectWorkspaceEnvRecord | undefined>;
}

/** Production resolver for the persisted user/workspace layers plus non-secret agent config. */
export class StoredExecutionEnvService {
  constructor(private readonly dependencies: StoredExecutionEnvDependencies) {}

  resolve = async (input: ResolveStoredExecutionEnvInput): Promise<ExecutionEnv> => {
    let userRecord: ProjectWorkspaceEnvRecord | undefined;
    let workspaceRecord: ProjectWorkspaceEnvRecord | undefined;
    // Every persisted value is encrypted at rest, regardless of its UI
    // `secret` classification. Present it as encrypted to the generic adapter
    // so only the precedence winner is decrypted; restore the UI classification
    // on the final winning set below.
    const encryptedRecord = (record: ProjectWorkspaceEnvRecord | undefined) =>
      record &&
      Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [key, { ...entry, secret: true }]),
      );
    const adapter = createExecutionEnvAdapter({
      decryptSecret: async ({ encryptedValue }) => this.dependencies.decrypt(encryptedValue),
      loadLayer: async (layer, request) => {
        if (layer === 'user') {
          userRecord = await this.dependencies.loadUserEnv(request.userId);
          return encryptedRecord(userRecord);
        }
        if (layer === 'workspace' && request.workspaceId) {
          workspaceRecord = await this.dependencies.loadWorkspaceEnv(
            request.workspaceId,
            request.userId,
          );
          return encryptedRecord(workspaceRecord);
        }
        if (layer === 'agent' && input.agentEnv) {
          return Object.fromEntries(
            Object.entries(input.agentEnv).map(([key, value]) => [key, { secret: false, value }]),
          );
        }
        return;
      },
    });
    const resolved = await adapter.resolve(input);
    return {
      ...resolved,
      secretKeys: Object.keys(resolved.values).filter((key) => {
        const source = resolved.sources[key];
        if (source === 'user') return userRecord?.[key]?.secret === true;
        if (source === 'workspace') return workspaceRecord?.[key]?.secret === true;
        return false;
      }),
    };
  };

  resolveAgencyConfig = (
    input: Omit<ResolveStoredExecutionEnvInput, 'agentEnv'> & {
      agencyConfig?: LobeAgentAgencyConfig | null;
    },
  ): Promise<ExecutionEnv> => {
    const { agencyConfig, ...request } = input;
    return this.resolve({
      ...request,
      agentEnv: agencyConfig?.env ?? agencyConfig?.heterogeneousProvider?.env,
    });
  };
}
