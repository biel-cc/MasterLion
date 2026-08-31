// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { NewApiBridgeError } from '../bridgeClient';
import { NewApiError } from '../client';
import { NewApiProvisioningError } from '../provisioningAdapter';
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
          new NewApiProvisioningError(
            'AIHUB_ADMIN_ACCESS_TOKEN is required for Aihub provisioning',
            'configuration',
            'aihub_admin_token_missing',
          ),
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
        code: 'aihub_admin_token_missing',
        kind: 'configuration',
      }),
    );
  });

  it('classifies a typed provisioning error without depending on its localized message', async () => {
    const { workflow } = createHarness();
    (workflow as any).provisionerFactory = () => ({
      provisionEnterpriseUser: vi
        .fn()
        .mockRejectedValue(
          new NewApiProvisioningError(
            '任意本地化文案',
            'identity_conflict',
            'aihub_identity_conflict',
          ),
        ),
    });

    await expect(
      workflow.provision({ identity, trigger: 'manual_retry', userId: 'user-1' }),
    ).rejects.toMatchObject({
      code: 'aihub_identity_conflict',
      kind: 'identity_conflict',
      message: '任意本地化文案',
    });
  });

  it.each([
    [401, 'configuration', 'aihub_admin_auth_rejected'],
    [422, 'permanent', 'aihub_request_rejected'],
    [503, 'transient', 'aihub_upstream_unavailable'],
  ] as const)(
    'classifies NewAPI HTTP %s structurally as %s',
    async (status, expectedKind, expectedCode) => {
      const { workflow } = createHarness();
      (workflow as any).provisionerFactory = () => ({
        provisionEnterpriseUser: vi
          .fn()
          .mockRejectedValue(new NewApiError('上游文案可以改变', status)),
      });

      await expect(
        workflow.provision({ identity, trigger: 'manual_retry', userId: 'user-1' }),
      ).rejects.toMatchObject({ code: expectedCode, kind: expectedKind });
    },
  );

  it('uses the bridge error code for identity conflicts', async () => {
    const { workflow } = createHarness();
    (workflow as any).provisionerFactory = () => ({
      provisionEnterpriseUser: vi
        .fn()
        .mockRejectedValue(new NewApiBridgeError('绑定冲突', 409, 'binding_conflict')),
    });

    await expect(
      workflow.provision({ identity, trigger: 'manual_retry', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'aihub_identity_conflict', kind: 'identity_conflict' });
  });

  it('does not infer a stable cooldown from an untyped error message', async () => {
    const { workflow } = createHarness();
    (workflow as any).provisionerFactory = () => ({
      provisionEnterpriseUser: vi
        .fn()
        .mockRejectedValue(new Error('does not belong to user; wording is not a contract')),
    });

    await expect(
      workflow.provision({ identity, trigger: 'manual_retry', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'aihub_provisioning_failed', kind: 'transient' });
  });
});
