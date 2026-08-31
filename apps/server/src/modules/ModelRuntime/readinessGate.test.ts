// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import {
  AihubModelProviderReadinessError,
  ensureModelProviderReadiness,
  isEnterpriseManagedAihubUser,
} from './index';

const createManagedUserDb = (input: {
  account?: { id: string };
  binding?: { readinessVersion: number };
  identity?: { id: string };
}) => ({
  query: {
    account: { findFirst: vi.fn().mockResolvedValue(input.account) },
    externalIdentities: { findFirst: vi.fn().mockResolvedValue(input.identity) },
    newApiBindings: { findFirst: vi.fn().mockResolvedValue(input.binding) },
  },
});

describe('isEnterpriseManagedAihubUser', () => {
  it('short-circuits on a v2 binding without reading historical identity tables', async () => {
    const db = createManagedUserDb({ binding: { readinessVersion: 2 } });

    await expect(isEnterpriseManagedAihubUser(db as any, 'user-1')).resolves.toBe(true);

    expect(db.query.newApiBindings.findFirst).toHaveBeenCalledOnce();
    expect(db.query.externalIdentities.findFirst).not.toHaveBeenCalled();
    expect(db.query.account.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to historical WeCom identities before a user reaches v2', async () => {
    const db = createManagedUserDb({
      binding: { readinessVersion: 1 },
      identity: { id: 'wecom-identity' },
    });

    await expect(isEnterpriseManagedAihubUser(db as any, 'user-1')).resolves.toBe(true);

    expect(db.query.externalIdentities.findFirst).toHaveBeenCalledOnce();
    expect(db.query.account.findFirst).toHaveBeenCalledOnce();
  });
});

describe('ensureModelProviderReadiness', () => {
  it('does not invoke Aihub readiness for unrelated providers', async () => {
    const factory = vi.fn();

    await ensureModelProviderReadiness({} as any, 'user-1', ModelProvider.OpenAI, factory as any);

    expect(factory).not.toHaveBeenCalled();
  });

  it('waits for strong Aihub readiness before allowing NewAPI runtime creation', async () => {
    const ensure = vi.fn().mockResolvedValue({ isBound: true, status: 'active' });
    const factory = vi.fn(() => ({ ensure }));
    const isManagedUser = vi.fn().mockResolvedValue(true);

    await ensureModelProviderReadiness(
      {} as any,
      'user-1',
      ModelProvider.NewAPI,
      factory as any,
      isManagedUser,
    );

    expect(isManagedUser).toHaveBeenCalledWith({}, 'user-1');
    expect(ensure).toHaveBeenCalledWith('user-1', { trigger: 'model_runtime' });
  });

  it('does not force enterprise readiness on legacy manual NewAPI users', async () => {
    const factory = vi.fn();
    const isManagedUser = vi.fn().mockResolvedValue(false);

    await ensureModelProviderReadiness(
      {} as any,
      'manual-user',
      ModelProvider.NewAPI,
      factory as any,
      isManagedUser,
    );

    expect(factory).not.toHaveBeenCalled();
  });

  it('stops runtime creation with the persisted readiness error', async () => {
    const factory = vi.fn(() => ({
      ensure: vi.fn().mockResolvedValue({
        errorCode: 'admin_token_missing',
        errorMessage: 'Aihub administrator token is missing',
        status: 'error',
      }),
    }));

    await expect(
      ensureModelProviderReadiness(
        {} as any,
        'user-1',
        ModelProvider.NewAPI,
        factory as any,
        vi.fn().mockResolvedValue(true),
      ),
    ).rejects.toThrow('Aihub administrator token is missing');
  });

  it('surfaces the bounded-wait timeout instead of a generic readiness error', async () => {
    const factory = vi.fn(() => ({
      ensure: vi.fn().mockResolvedValue({
        errorCode: 'aihub_readiness_initializing',
        errorMessage: 'Aihub is still initializing. Please retry shortly.',
        errorKind: 'transient',
        retryAfterMs: 2000,
        retryable: true,
        status: 'pending',
      }),
    }));

    const promise = ensureModelProviderReadiness(
      {} as any,
      'user-1',
      ModelProvider.NewAPI,
      factory as any,
      vi.fn().mockResolvedValue(true),
    );

    await expect(promise).rejects.toBeInstanceOf(AihubModelProviderReadinessError);
    await expect(promise).rejects.toMatchObject({
      code: 'aihub_readiness_initializing',
      errorType: 'AihubReadinessUnavailable',
      kind: 'transient',
      retryAfterMs: 2000,
      retryable: true,
      status: 'pending',
    });
  });

  it('preserves a non-retryable readiness classification', async () => {
    const factory = vi.fn(() => ({
      ensure: vi.fn().mockResolvedValue({
        errorCode: 'masterino_username_mismatch',
        errorKind: 'identity_conflict',
        errorMessage: 'Masterino username does not match enterprise employee number',
        retryable: false,
        status: 'error',
      }),
    }));

    await expect(
      ensureModelProviderReadiness(
        {} as any,
        'user-1',
        ModelProvider.NewAPI,
        factory as any,
        vi.fn().mockResolvedValue(true),
      ),
    ).rejects.toMatchObject({
      code: 'masterino_username_mismatch',
      errorType: 'AihubReadinessUnavailable',
      kind: 'identity_conflict',
      retryable: false,
      status: 'error',
    });
  });
});
