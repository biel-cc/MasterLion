import { describe, expect, it, vi } from 'vitest';

import {
  isTransientDatabaseReadError,
  ModelProviderConfigurationUnavailableError,
  withTransientDatabaseReadRetry,
} from './databaseReadRetry';

describe('withTransientDatabaseReadRetry', () => {
  it.each(['57P03', '57P01', '08006'])('recognizes transient PostgreSQL code %s', (code) => {
    expect(
      isTransientDatabaseReadError(Object.assign(new Error('database unavailable'), { code })),
    ).toBe(true);
  });

  it('retries nested transient failures and returns the successful read', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('query failed'), {
          cause: Object.assign(new Error('database is starting'), { code: '57P03' }),
        }),
      )
      .mockResolvedValue({ id: 'newapi' });
    const sleep = vi.fn(async () => {});

    await expect(withTransientDatabaseReadRetry(operation, { sleep })).resolves.toEqual({
      id: 'newapi',
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('sanitizes the final transient error after three retries', async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error('select user_Ffc... from ai_providers'), { code: '08006' });
    });

    await expect(
      withTransientDatabaseReadRetry(operation, { sleep: async () => {} }),
    ).rejects.toEqual(new ModelProviderConfigurationUnavailableError());
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('does not retry a non-transient query error', async () => {
    const operation = vi.fn(async () => {
      throw Object.assign(new Error('invalid column'), { code: '42703' });
    });

    await expect(
      withTransientDatabaseReadRetry(operation, { sleep: async () => {} }),
    ).rejects.toMatchObject({ code: '42703' });
    expect(operation).toHaveBeenCalledOnce();
  });
});
