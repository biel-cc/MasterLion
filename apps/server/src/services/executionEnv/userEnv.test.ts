import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserModel } from '@/database/models/user';

import { UserEnvService } from './userEnv';

describe('UserEnvService', () => {
  const getUserSettings = vi.fn();
  const updateSetting = vi.fn();
  const encrypt = vi.fn(async (value: string) => `sealed:${value}`);
  const model = { getUserSettings, updateSetting } as unknown as UserModel;

  beforeEach(() => {
    getUserSettings.mockReset();
    updateSetting.mockReset();
    encrypt.mockClear();
  });

  it('encrypts user values at rest and returns key metadata only', async () => {
    getUserSettings
      .mockResolvedValueOnce({ executionEnv: { EXISTING: { secret: false, value: 'sealed:old' } } })
      .mockResolvedValueOnce({
        executionEnv: {
          EXISTING: { secret: false, value: 'sealed:old' },
          TOKEN: { secret: true, value: 'sealed:plain-token' },
        },
      });
    const service = new UserEnvService(model, { encrypt });

    await service.save({ key: 'TOKEN', secret: true, value: 'plain-token' });

    expect(updateSetting).toHaveBeenCalledWith({
      executionEnv: {
        EXISTING: { secret: false, value: 'sealed:old' },
        TOKEN: { secret: true, value: 'sealed:plain-token' },
      },
    });
    expect(await service.list()).toEqual([
      { key: 'EXISTING', secret: false },
      { key: 'TOKEN', secret: true },
    ]);
    expect(JSON.stringify(await service.list())).not.toContain('plain-token');
  });

  it('removes a user key without decrypting retained values', async () => {
    getUserSettings.mockResolvedValue({
      executionEnv: {
        KEEP: { secret: true, value: 'sealed:keep' },
        REMOVE: { secret: false, value: 'sealed:remove' },
      },
    });
    const service = new UserEnvService(model, { encrypt });

    await service.revoke('REMOVE');

    expect(updateSetting).toHaveBeenCalledWith({
      executionEnv: { KEEP: { secret: true, value: 'sealed:keep' } },
    });
    expect(encrypt).not.toHaveBeenCalled();
  });
});
