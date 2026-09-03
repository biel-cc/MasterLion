import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';
import { TRPCError } from '@trpc/server';

import type { UserModel } from '@/database/models/user';
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

export interface SaveUserEnvEntryInput {
  key: string;
  secret: boolean;
  value: string;
}

/** User-scoped encrypted env persistence. Browser callers only receive key metadata. */
export class UserEnvService {
  constructor(
    private readonly userModel: Pick<UserModel, 'getUserSettings' | 'updateSetting'>,
    private readonly gateKeeper: Pick<KeyVaultsGateKeeper, 'encrypt'>,
  ) {}

  private getRecord = async (): Promise<ProjectWorkspaceEnvRecord> => {
    const settings = await this.userModel.getUserSettings();
    return settings?.executionEnv ?? {};
  };

  list = async (): Promise<BrowserExecutionEnvEntry[]> =>
    Object.entries(await this.getRecord())
      .map(([key, entry]) => ({ key, secret: entry.secret }))
      .sort((left, right) => left.key.localeCompare(right.key));

  save = async ({ key, secret, value }: SaveUserEnvEntryInput): Promise<void> => {
    requireConfigurableKey(key);
    if (!value) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Value is required' });
    const executionEnv = await this.getRecord();
    executionEnv[key] = { secret, value: await this.gateKeeper.encrypt(value) };
    await this.userModel.updateSetting({ executionEnv });
  };

  revoke = async (key: string): Promise<void> => {
    requireConfigurableKey(key);
    const executionEnv = await this.getRecord();
    delete executionEnv[key];
    await this.userModel.updateSetting({
      executionEnv: Object.keys(executionEnv).length > 0 ? executionEnv : null,
    });
  };
}
