// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { DatabaseAihubReadinessBindingStore, inspectAihubLocalRuntime } from './persistence';

const createDb = (keyVaults: string | null) => ({
  query: {
    aiProviders: {
      findFirst: vi.fn().mockResolvedValue({ enabled: true, keyVaults }),
    },
  },
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ count: 2 }]),
    })),
  })),
});

describe('inspectAihubLocalRuntime', () => {
  it('accepts an authenticated encrypted provider config with a non-empty apiKey', async () => {
    const gateKeeper = {
      decrypt: vi.fn().mockResolvedValue({
        plaintext: JSON.stringify({ apiKey: 'sk-managed' }),
        wasAuthentic: true,
      }),
    };

    await expect(
      inspectAihubLocalRuntime(createDb('ciphertext') as any, 'user-1', gateKeeper as any),
    ).resolves.toEqual({ hasApiKey: true, modelCount: 2 });
  });

  it.each([
    ['an empty key vault', JSON.stringify({})],
    ['an empty apiKey', JSON.stringify({ apiKey: '   ' })],
    ['invalid JSON', '{'],
  ])('rejects %s instead of reporting the provider ready', async (_label, plaintext) => {
    const gateKeeper = {
      decrypt: vi.fn().mockResolvedValue({ plaintext, wasAuthentic: true }),
    };

    await expect(
      inspectAihubLocalRuntime(createDb('ciphertext') as any, 'user-1', gateKeeper as any),
    ).resolves.toEqual({ hasApiKey: false, modelCount: 2 });
  });

  it('rejects provider key vaults that cannot be authenticated', async () => {
    const gateKeeper = {
      decrypt: vi.fn().mockResolvedValue({ plaintext: '', wasAuthentic: false }),
    };

    await expect(
      inspectAihubLocalRuntime(createDb('ciphertext') as any, 'user-1', gateKeeper as any),
    ).resolves.toEqual({ hasApiKey: false, modelCount: 2 });
  });
});

describe('DatabaseAihubReadinessBindingStore', () => {
  it('resets the failure attempt count after readiness becomes active', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const db = { insert: vi.fn(() => ({ values })) };
    const store = new DatabaseAihubReadinessBindingStore(db as any);

    await store.markActive('user-1', {
      managedTokenId: 8001,
      modelCount: 3,
      newApiUserId: 9001,
      readinessVersion: 2,
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: 0 }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ attemptCount: 0 }),
      }),
    );
  });

  it('records a reconciliation failure without downgrading the active binding', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const db = { update: vi.fn(() => ({ set })) };
    const store = new DatabaseAihubReadinessBindingStore(db as any);

    await store.markReconcileError('user-1', {
      errorCode: 'aihub_bridge_unavailable',
      errorKind: 'transient',
      errorMessage: 'bridge timeout',
      nextRetryAt: new Date('2026-09-01T08:00:00.000Z'),
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'aihub_bridge_unavailable',
        errorKind: 'transient',
        status: 'active',
      }),
    );
    expect(where).toHaveBeenCalledOnce();
  });
});
