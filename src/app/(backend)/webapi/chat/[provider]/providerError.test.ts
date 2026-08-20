import { describe, expect, it } from 'vitest';

import { serializeProviderError } from './providerError';

describe('serializeProviderError', () => {
  it('preserves safe diagnostics from a native Error', () => {
    const error = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      request_id: 'upstream-123',
      status: 502,
    });

    expect(serializeProviderError(error)).toEqual({
      code: 'ECONNRESET',
      message: 'socket hang up',
      name: 'Error',
      requestId: 'upstream-123',
      status: 502,
    });
  });

  it('does not copy credentials or arbitrary response data', () => {
    expect(
      serializeProviderError({
        apiKey: 'secret',
        body: { prompt: 'private' },
        message: 'failed',
        response: { authorization: 'Bearer secret' },
      }),
    ).toEqual({ message: 'failed', name: 'Error' });
  });
});
