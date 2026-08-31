// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ProductionAihubReadinessWorkflow } from './production';

const identity = {
  email: 'ada@example.com',
  employeeNumber: '10184591',
  employmentStatus: 'active',
  masterinoUsername: '10184591',
  name: 'Ada',
};

const createHarness = () => {
  const provisionEnterpriseUser = vi.fn().mockResolvedValue({
    iamOAuthBinding: { outcome: 'existing', status: 'active' },
    managedTokenId: 8001,
    newApiUserId: 9001,
    status: 'active',
  });
  const saveRemoteIdentifiers = vi.fn().mockResolvedValue(undefined);
  const syncModels = vi.fn().mockResolvedValue({ models: [{ id: 'gpt-5' }] });
  const inspectRuntime = vi.fn().mockResolvedValue({ hasApiKey: true, modelCount: 1 });
  const workflow = new ProductionAihubReadinessWorkflow({
    db: {} as any,
    getPolicy: vi.fn().mockResolvedValue({
      aihubProvisioning: {
        autoCreateUser: true,
        enabled: true,
        managedTokenName: 'masterlion-managed',
      },
    }),
    inspectRuntime,
    provisionerFactory: () => ({ provisionEnterpriseUser }),
    saveRemoteIdentifiers,
    syncModels,
  });

  return {
    inspectRuntime,
    provisionEnterpriseUser,
    saveRemoteIdentifiers,
    syncModels,
    workflow,
  };
};

describe('ProductionAihubReadinessWorkflow', () => {
  it('persists stable remote ids before syncing the local provider and models', async () => {
    const { provisionEnterpriseUser, saveRemoteIdentifiers, syncModels, workflow } =
      createHarness();

    const result = await workflow.provision({
      binding: { managedTokenId: 7001, newApiUserId: 9001, status: 'error' },
      identity,
      trigger: 'oidc_authorized',
      userId: 'user-1',
    });

    expect(provisionEnterpriseUser).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeNumber: '10184591',
        masterinoUsername: '10184591',
        preferredManagedTokenId: 7001,
      }),
    );
    expect(saveRemoteIdentifiers).toHaveBeenCalledWith('user-1', {
      managedTokenId: 8001,
      newApiUserId: 9001,
    });
    expect(saveRemoteIdentifiers.mock.invocationCallOrder[0]).toBeLessThan(
      syncModels.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({
      iamOAuthBinding: { status: 'active' },
      managedTokenId: 8001,
      modelCount: 1,
      newApiUserId: 9001,
    });
  });

  it('does not report active when model sync did not persist an encrypted provider key', async () => {
    const { inspectRuntime, workflow } = createHarness();
    inspectRuntime.mockResolvedValue({ hasApiKey: false, modelCount: 2 });

    await expect(
      workflow.provision({
        identity,
        trigger: 'model_runtime',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      code: 'aihub_models_unavailable',
      kind: 'entitlement',
    });
  });

  it('classifies a missing administrator credential as configuration, not transient', async () => {
    const { workflow } = createHarness();
    (workflow as any).provisionerFactory = () => ({
      provisionEnterpriseUser: vi
        .fn()
        .mockRejectedValue(
          new Error('AIHUB_ADMIN_ACCESS_TOKEN is required for Aihub provisioning'),
        ),
    });

    await expect(
      workflow.provision({
        identity,
        trigger: 'manual_retry',
        userId: 'user-1',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'aihub_configuration_invalid',
        kind: 'configuration',
      }),
    );
  });
});
