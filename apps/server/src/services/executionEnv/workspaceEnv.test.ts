import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';

import { WorkspaceEnvService } from './workspaceEnv';

describe('WorkspaceEnvService', () => {
  const findById = vi.fn();
  const updateEnvironment = vi.fn();
  const encrypt = vi.fn(async (value: string) => `sealed:${value}`);
  const model = { findById, updateEnvironment } as unknown as ProjectWorkspaceModel;

  beforeEach(() => {
    findById.mockReset();
    updateEnvironment.mockReset();
    encrypt.mockClear();
  });

  it('encrypts every value at rest and exposes only key metadata', async () => {
    findById
      .mockResolvedValueOnce({ env: { EXISTING: { secret: false, value: 'sealed:old' } } })
      .mockResolvedValueOnce({
        env: {
          API_TOKEN: { secret: true, value: 'sealed:plain-token' },
          EXISTING: { secret: false, value: 'sealed:old' },
        },
      });
    const service = new WorkspaceEnvService(model, { encrypt });

    await service.save({
      key: 'API_TOKEN',
      secret: true,
      value: 'plain-token',
      workspaceId: 'ws-1',
    });

    expect(encrypt).toHaveBeenCalledWith('plain-token');
    expect(updateEnvironment).toHaveBeenCalledWith('ws-1', {
      env: {
        API_TOKEN: { secret: true, value: 'sealed:plain-token' },
        EXISTING: { secret: false, value: 'sealed:old' },
      },
    });
    expect(await service.list('ws-1')).toEqual([
      { key: 'API_TOKEN', secret: true },
      { key: 'EXISTING', secret: false },
    ]);
  });

  it('removes one key without returning or decrypting another value', async () => {
    findById.mockResolvedValue({
      env: {
        KEEP: { secret: true, value: 'sealed:keep' },
        REMOVE: { secret: true, value: 'sealed:remove' },
      },
    });
    const service = new WorkspaceEnvService(model, { encrypt });

    await service.revoke('ws-1', 'REMOVE');

    expect(updateEnvironment).toHaveBeenCalledWith('ws-1', {
      env: { KEEP: { secret: true, value: 'sealed:keep' } },
    });
    expect(encrypt).not.toHaveBeenCalled();
  });

});
