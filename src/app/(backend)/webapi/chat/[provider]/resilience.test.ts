import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isRetryableProviderError,
  resetProviderCircuitForTest,
  runWithTransientRetry,
  UpstreamCircuitOpenError,
} from './resilience';

afterEach(() => resetProviderCircuitForTest());

describe('NewAPI resilience', () => {
  it.each([
    [{ code: 'ECONNRESET' }, true],
    [{ status: 502 }, true],
    [{ status: 503 }, true],
    [{ status: 504 }, true],
    [{ status: 401 }, false],
    [{ status: 403 }, false],
    [{ status: 429 }, false],
  ])('classifies retryable errors', (error, expected) => {
    expect(isRetryableProviderError(error)).toBe(expected);
  });

  it('retries twice and returns the successful response', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue('ok');

    await expect(
      runWithTransientRetry({
        operation,
        provider: 'newapi',
        random: () => 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient failures', async () => {
    const operation = vi.fn().mockRejectedValue({ status: 401 });

    await expect(
      runWithTransientRetry({ operation, provider: 'newapi', sleep: vi.fn() }),
    ).rejects.toEqual({ status: 401 });
    expect(operation).toHaveBeenCalledOnce();
  });

  it('opens the circuit after repeated failed requests', async () => {
    let now = 1_000;
    const failure = { code: 'ECONNRESET' };

    for (let index = 0; index < 5; index++) {
      await expect(
        runWithTransientRetry({
          maxAttempts: 1,
          now: () => now++,
          operation: vi.fn().mockRejectedValue(failure),
          provider: 'newapi',
        }),
      ).rejects.toBe(failure);
    }

    await expect(
      runWithTransientRetry({
        maxAttempts: 1,
        now: () => now,
        operation: vi.fn(),
        provider: 'newapi',
      }),
    ).rejects.toBeInstanceOf(UpstreamCircuitOpenError);
  });
});
