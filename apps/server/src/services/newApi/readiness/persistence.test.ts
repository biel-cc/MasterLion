// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { inspectAihubLocalRuntime } from './persistence';

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
