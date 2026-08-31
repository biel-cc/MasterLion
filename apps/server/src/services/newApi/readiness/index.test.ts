// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AihubReadiness, AihubReadinessError } from './index';

const activeResources = {
  iamOAuthBinding: { status: 'active' as const },
  managedTokenId: 8001,
  modelCount: 3,
  newApiUserId: 9001,
};

const createHarness = (overrides: Record<string, unknown> = {}) => {
  const bindingStore = {
    get: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn().mockResolvedValue(undefined),
    markPending: vi.fn().mockResolvedValue(undefined),
    updateIamBinding: vi.fn().mockResolvedValue(undefined),
  };
  const lease = {
    acquire: vi.fn().mockResolvedValue({
      expiresAt: new Date('2026-08-31T01:01:00.000Z'),
      ownerId: 'attempt-1',
    }),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const workflow = {
    inspectLocalRuntime: vi.fn().mockResolvedValue({ hasApiKey: false, modelCount: 0 }),
    provision: vi.fn().mockResolvedValue(activeResources),
  };
  const identitySource = {
    getEnterpriseIdentity: vi.fn().mockResolvedValue({
      email: 'ada@example.com',
      employeeNumber: '10184591',
      employmentStatus: 'active',
      masterinoUsername: '10184591',
      name: 'Ada',
    }),
  };

  const readiness = new AihubReadiness({
    bindingStore,
    identitySource,
    lease,
    now: () => new Date('2026-08-31T01:00:00.000Z'),
    workflow,
    ...overrides,
  } as any);

  return { bindingStore, identitySource, lease, readiness, workflow };
};

describe('AihubReadiness', () => {
  it('keeps get as a pure projection without acquiring leases or provisioning', async () => {
    const { bindingStore, identitySource, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      managedTokenId: 8001,
      newApiUserId: 9001,
      readinessVersion: 2,
      status: 'active',
    });
    workflow.inspectLocalRuntime.mockResolvedValue({ hasApiKey: true, modelCount: 3 });

    await expect(readiness.get('user-1')).resolves.toMatchObject({
      isBound: true,
      status: 'active',
    });

    expect(identitySource.getEnterpriseIdentity).not.toHaveBeenCalled();
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(bindingStore.markActive).not.toHaveBeenCalled();
    expect(bindingStore.markError).not.toHaveBeenCalled();
    expect(bindingStore.markPending).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('returns a verified v2 active binding without entering the write workflow', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      managedTokenId: 8001,
      newApiUserId: 9001,
      readinessVersion: 2,
      status: 'active',
    });
    workflow.inspectLocalRuntime.mockResolvedValue({ hasApiKey: true, modelCount: 3 });

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state.status).toBe('active');
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('allows an explicit manual sync to revalidate an already-active binding', async () => {
    const { bindingStore, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      managedTokenId: 8001,
      newApiUserId: 9001,
      readinessVersion: 2,
      status: 'active',
    });
    workflow.inspectLocalRuntime.mockResolvedValue({ hasApiKey: true, modelCount: 3 });

    await readiness.ensure('user-1', { force: true, trigger: 'manual_model_sync' });

    expect(workflow.provision).toHaveBeenCalledOnce();
  });

  it('revalidates a historical v1 active row before treating it as ready', async () => {
    const { bindingStore, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      managedTokenId: 8001,
      newApiUserId: 9001,
      readinessVersion: 1,
      status: 'active',
    });
    workflow.inspectLocalRuntime.mockResolvedValue({ hasApiKey: true, modelCount: 3 });

    await expect(readiness.get('user-1')).resolves.toMatchObject({
      isBound: true,
      readinessVersion: 1,
      status: 'active',
    });

    await readiness.ensure('user-1', { trigger: 'oidc_authorized' });

    expect(workflow.provision).toHaveBeenCalledOnce();
    expect(bindingStore.markActive).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ readinessVersion: 2 }),
    );
  });

  it('converges a previously missing enterprise user to strong active readiness', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();

    const state = await readiness.ensure('user-1', { trigger: 'oidc_authorized' });

    expect(state).toMatchObject({
      isBound: true,
      managedTokenId: 8001,
      newApiUserId: 9001,
      readinessVersion: 2,
      status: 'active',
    });
    expect(workflow.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ employeeNumber: '10184591' }),
        userId: 'user-1',
      }),
    );
    expect(bindingStore.markActive).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        managedTokenId: 8001,
        modelCount: 3,
        newApiUserId: 9001,
        readinessVersion: 2,
      }),
    );
    expect(lease.release).toHaveBeenCalledWith('user-1', 'attempt-1');
  });

  it('returns pending immediately for a background trigger when another process owns the lease', async () => {
    const { lease, readiness, workflow } = createHarness();
    lease.acquire.mockResolvedValue(undefined);

    const state = await readiness.ensure('user-1', { trigger: 'oidc_authorized' });

    expect(state).toMatchObject({ status: 'pending' });
    expect(workflow.provision).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it('waits for an in-flight owner to activate readiness for the model runtime', async () => {
    let binding: any;
    const sleep = vi.fn(async () => {
      binding = {
        managedTokenId: 8001,
        newApiUserId: 9001,
        readinessVersion: 2,
        status: 'active',
      };
    });
    const { bindingStore, lease, readiness, workflow } = createHarness({
      pendingWaitDelaysMs: [10],
      sleep,
    });
    bindingStore.get.mockImplementation(async () => binding);
    lease.acquire.mockResolvedValue(undefined);
    workflow.inspectLocalRuntime.mockResolvedValue({ hasApiKey: true, modelCount: 3 });

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({ isBound: true, status: 'active' });
    expect(sleep).toHaveBeenCalledOnce();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('returns the persisted owner error while waiting for model runtime readiness', async () => {
    let binding: any;
    const sleep = vi.fn(async () => {
      binding = {
        errorCode: 'admin_token_missing',
        errorKind: 'configuration',
        errorMessage: 'Aihub administrator token is missing',
        status: 'error',
      };
    });
    const { bindingStore, lease, readiness, workflow } = createHarness({
      pendingWaitDelaysMs: [10],
      sleep,
    });
    bindingStore.get.mockImplementation(async () => binding);
    lease.acquire.mockResolvedValue(undefined);

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({
      errorCode: 'admin_token_missing',
      errorMessage: 'Aihub administrator token is missing',
      status: 'error',
    });
    expect(workflow.inspectLocalRuntime).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('returns a stable retryable pending error when the in-flight owner does not finish in time', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { bindingStore, lease, readiness, workflow } = createHarness({
      pendingWaitDelaysMs: [10, 20],
      sleep,
    });
    bindingStore.get.mockResolvedValue({ status: 'pending' });
    lease.acquire.mockResolvedValue(undefined);

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({
      errorCode: 'aihub_readiness_initializing',
      errorKind: 'transient',
      errorMessage: 'Aihub is still initializing. Please retry shortly.',
      retryAfterMs: 2000,
      retryable: true,
      status: 'pending',
    });
    expect(bindingStore.get).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
    expect(workflow.inspectLocalRuntime).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('persists a non-retryable identity conflict instead of provisioning a different account', async () => {
    const { bindingStore, identitySource, readiness, workflow } = createHarness();
    identitySource.getEnterpriseIdentity.mockResolvedValue({
      employeeNumber: '10184591',
      employmentStatus: 'active',
      masterinoUsername: 'different-user',
      name: 'Ada',
    });

    const state = await readiness.ensure('user-1', { trigger: 'manual_retry' });

    expect(state).toMatchObject({
      errorCode: 'masterino_username_mismatch',
      errorKind: 'identity_conflict',
      retryable: false,
      status: 'error',
    });
    expect(workflow.provision).not.toHaveBeenCalled();
    expect(bindingStore.markError).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        errorCode: 'masterino_username_mismatch',
        errorKind: 'identity_conflict',
      }),
    );
  });

  it('keeps the core binding active when the secondary IAM state cannot be persisted', async () => {
    const { bindingStore, readiness } = createHarness();
    bindingStore.updateIamBinding.mockRejectedValue(new Error('audit database unavailable'));

    const state = await readiness.ensure('user-1', { trigger: 'oidc_authorized' });

    expect(state).toMatchObject({ isBound: true, status: 'active' });
    expect(bindingStore.markError).not.toHaveBeenCalled();
  });

  it('honors a persisted transient backoff without acquiring a lease', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      errorKind: 'transient',
      nextRetryAt: new Date('2026-08-31T01:00:10.000Z'),
      status: 'error',
    });

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({ retryAfterMs: 10_000, retryable: true, status: 'error' });
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('honors a persisted configuration cooldown without acquiring a lease', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      errorCode: 'admin_token_missing',
      errorKind: 'configuration',
      nextRetryAt: new Date('2026-08-31T01:10:00.000Z'),
      status: 'error',
    });

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({
      errorCode: 'admin_token_missing',
      retryAfterMs: 600_000,
      retryable: false,
      status: 'error',
    });
    expect(bindingStore.get).toHaveBeenCalledOnce();
    expect(workflow.inspectLocalRuntime).not.toHaveBeenCalled();
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('allows an explicit retry to bypass a persisted configuration cooldown', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      errorCode: 'admin_token_missing',
      errorKind: 'configuration',
      nextRetryAt: new Date('2026-08-31T01:10:00.000Z'),
      status: 'error',
    });

    const state = await readiness.ensure('user-1', {
      force: true,
      trigger: 'manual_retry',
    });

    expect(state).toMatchObject({ isBound: true, status: 'active' });
    expect(lease.acquire).toHaveBeenCalledOnce();
    expect(workflow.provision).toHaveBeenCalledOnce();
  });

  it('does not automatically retry a permanent error from the model runtime hot path', async () => {
    const { bindingStore, lease, readiness, workflow } = createHarness();
    bindingStore.get.mockResolvedValue({
      errorCode: 'employment_inactive',
      errorKind: 'permanent',
      errorMessage: 'Enterprise employment status is not active',
      nextRetryAt: null,
      status: 'error',
    });

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({
      errorCode: 'employment_inactive',
      retryable: false,
      status: 'error',
    });
    expect(lease.acquire).not.toHaveBeenCalled();
    expect(workflow.provision).not.toHaveBeenCalled();
  });

  it('schedules a jittered long cooldown for classified configuration failures', async () => {
    const { bindingStore, readiness, workflow } = createHarness({ random: () => 0.5 });
    workflow.provision.mockRejectedValue(
      new AihubReadinessError(
        'AIHUB_ADMIN_ACCESS_TOKEN is required',
        'configuration',
        'admin_token_missing',
      ),
    );

    const state = await readiness.ensure('user-1', { trigger: 'manual_retry' });

    expect(state).toMatchObject({
      errorCode: 'admin_token_missing',
      errorKind: 'configuration',
      retryAfterMs: 1_800_000,
      retryable: false,
      status: 'error',
    });
    expect(bindingStore.markError).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ nextRetryAt: new Date('2026-08-31T01:30:00.000Z') }),
    );
  });

  it('schedules the same load-protecting cooldown for entitlement failures', async () => {
    const { bindingStore, readiness, workflow } = createHarness({ random: () => 0.5 });
    workflow.provision.mockRejectedValue(
      new AihubReadinessError(
        'No accessible Aihub models are available',
        'entitlement',
        'aihub_models_unavailable',
      ),
    );

    const state = await readiness.ensure('user-1', { trigger: 'model_runtime' });

    expect(state).toMatchObject({
      errorCode: 'aihub_models_unavailable',
      errorKind: 'entitlement',
      retryAfterMs: 1_800_000,
      retryable: false,
      status: 'error',
    });
    expect(bindingStore.markError).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ nextRetryAt: new Date('2026-08-31T01:30:00.000Z') }),
    );
  });

  it('lets only one of twenty concurrent requests enter the provisioning workflow', async () => {
    let owner: string | undefined;
    const releaseProvision = Promise.withResolvers<void>();
    const harness = createHarness({
      lease: {
        acquire: vi.fn(async (_userId: string, requestedOwnerId: string) => {
          if (owner) return undefined;
          owner = requestedOwnerId;
          return {
            expiresAt: new Date('2026-08-31T01:01:00.000Z'),
            ownerId: requestedOwnerId,
          };
        }),
        release: vi.fn(async (_userId: string, requestedOwnerId: string) => {
          if (owner === requestedOwnerId) owner = undefined;
        }),
      },
      randomId: (() => {
        let id = 0;
        return () => `attempt-${++id}`;
      })(),
    });
    harness.workflow.provision.mockImplementation(async () => {
      await releaseProvision.promise;
      return activeResources;
    });

    const requests = Array.from({ length: 20 }, () =>
      harness.readiness.ensure('user-1', { trigger: 'oidc_authorized' }),
    );
    await vi.waitFor(() => expect(harness.workflow.provision).toHaveBeenCalledOnce());
    releaseProvision.resolve();
    const states = await Promise.all(requests);

    expect(states.filter((state) => state.status === 'active')).toHaveLength(1);
    expect(states.filter((state) => state.status === 'pending')).toHaveLength(19);
    expect(harness.workflow.provision).toHaveBeenCalledOnce();
  });

  it('reuses persisted readiness after a same-user logout and Electron relaunch', async () => {
    let record: any;
    const bindingStore = {
      get: vi.fn(async () => record),
      markActive: vi.fn(async (_userId: string, input: any) => {
        record = { ...input, status: 'active' };
      }),
      markError: vi.fn(),
      markPending: vi.fn(),
      updateIamBinding: vi.fn(),
    };
    const workflow = {
      inspectLocalRuntime: vi.fn().mockResolvedValue({ hasApiKey: true, modelCount: 3 }),
      provision: vi.fn().mockResolvedValue(activeResources),
    };
    const options = {
      bindingStore,
      identitySource: {
        getEnterpriseIdentity: vi.fn().mockResolvedValue({
          employeeNumber: '10184591',
          employmentStatus: 'active',
          masterinoUsername: '10184591',
        }),
      },
      lease: {
        acquire: vi.fn().mockResolvedValue({ expiresAt: new Date(), ownerId: 'owner-1' }),
        release: vi.fn(),
      },
      workflow,
    };

    await new AihubReadiness(options as any).ensure('user-1', { trigger: 'oidc_authorized' });
    const relaunchedRuntime = new AihubReadiness(options as any);
    const state = await relaunchedRuntime.ensure('user-1', { trigger: 'model_runtime' });

    expect(state.status).toBe('active');
    expect(workflow.provision).toHaveBeenCalledOnce();
  });
});
