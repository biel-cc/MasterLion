// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { ensureModelProviderReadiness } from './index';

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
});
