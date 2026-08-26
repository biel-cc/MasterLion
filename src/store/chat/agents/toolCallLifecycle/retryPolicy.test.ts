import { describe, expect, it } from 'vitest';

import { isRetryableToolCallTransportError } from './retryPolicy';

describe('isRetryableToolCallTransportError', () => {
  it.each([408, 429, 502, 503, 504])('retries transient HTTP %s failures', (httpStatus) => {
    expect(isRetryableToolCallTransportError({ data: { httpStatus } })).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 413, 422])(
    'does not retry permanent HTTP %s failures',
    (httpStatus) => {
      expect(isRetryableToolCallTransportError({ data: { httpStatus } })).toBe(false);
    },
  );

  it('retries connection resets but never retries cancellation', () => {
    expect(isRetryableToolCallTransportError({ cause: { code: 'ECONNRESET' } })).toBe(true);
    expect(
      isRetryableToolCallTransportError(
        Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      ),
    ).toBe(false);
  });
});
