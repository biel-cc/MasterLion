import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';
import { TRPCError } from '@trpc/server';

import type { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';
import type { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type { BrowserExecutionEnvEntry } from './types';
import { assertConfigurableExecutionEnvKey } from './validation';

const requireConfigurableKey = (key: string): void => {
  try {
    assertConfigurableExecutionEnvKey(key);
  } catch (error) {
    throw new TRPCError({
      cause: error,
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Invalid environment variable name',
    });
  }
};

export interface SaveWorkspaceEnvEntryInput {
  key: string;
  secret: boolean;
  value: string;
  workspaceId: string;
}

/**
 * Server-only persistence boundary for project environment values.
 *
 * Every value is encrypted at rest, including values that are not presented as secrets in the
 * UI. Browser reads intentionally return only the variable name and its display classification.
 */
export class WorkspaceEnvService {
  constructor(
    private readonly workspaceModel: ProjectWorkspaceModel,
    private readonly gateKeeper: Pick<KeyVaultsGateKeeper, 'encrypt'>,
  ) {}

  private getRow = async (workspaceId: string) => {
    const row = await this.workspaceModel.findById(workspaceId);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    return row;
  };

  list = async (workspaceId: string): Promise<BrowserExecutionEnvEntry[]> => {
    const row = await this.getRow(workspaceId);
    return Object.entries(row.env ?? {})
      .map(([key, entry]) => ({ key, secret: entry.secret }))
      .sort((left, right) => left.key.localeCompare(right.key));
  };

  save = async ({ key, secret, value, workspaceId }: SaveWorkspaceEnvEntryInput): Promise<void> => {
    requireConfigurableKey(key);
    if (!value) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Value is required' });

    const row = await this.getRow(workspaceId);
    const encryptedValue = await this.gateKeeper.encrypt(value);
    const env: ProjectWorkspaceEnvRecord = {
      ...(row.env ?? {}),
      [key]: { secret, value: encryptedValue },
    };
    await this.workspaceModel.updateEnvironment(workspaceId, { env });
  };

  revoke = async (workspaceId: string, key: string): Promise<void> => {
    requireConfigurableKey(key);
    const row = await this.getRow(workspaceId);
    const env = { ...(row.env ?? {}) };
    delete env[key];
    await this.workspaceModel.updateEnvironment(workspaceId, {
      env: Object.keys(env).length > 0 ? env : null,
    });
  };
}
