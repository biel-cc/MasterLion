import { describe, expect, it, vi } from 'vitest';

import {
  createNotebookListRetryHandler,
  isRetryableNotebookListError,
} from './retryPolicy';

describe('isRetryableNotebookListError', () => {
  it.each([408, 429, 502, 503, 504])('retries temporary HTTP status %s', (httpStatus) => {
    expect(isRetryableNotebookListError({ data: { httpStatus } })).toBe(true);
  });

  it('retries the stable database unavailable reason', () => {
    expect(
      isRetryableNotebookListError({
        data: { errorData: { reason: 'DATABASE_RECOVERING' }, httpStatus: 503 },
      }),
    ).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('does not retry stable HTTP status %s', (httpStatus) => {
    expect(isRetryableNotebookListError({ data: { httpStatus } })).toBe(false);
  });

  it('honors errors explicitly marked non-retryable', () => {
    expect(
      isRetryableNotebookListError({
        data: { httpStatus: 503 },
        meta: { shouldRetry: false },
      }),
    ).toBe(false);
  });

  it('retries browser transport failures but not aborts', () => {
    expect(isRetryableNotebookListError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableNotebookListError({ name: 'AbortError' })).toBe(false);
  });
});

describe('createNotebookListRetryHandler', () => {
  it('schedules exactly two retries at 5s and 15s when jitter is neutral', () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = vi.fn((callback: () => void, delay: number) => {
      scheduled.push({ callback, delay });
      return 1;
    });
    const revalidate = vi.fn();
    const handler = createNotebookListRetryHandler({ random: () => 0.5, schedule });

    handler({}, 'notebook-key', {} as never, revalidate, { dedupe: true, retryCount: 1 });
    handler({}, 'notebook-key', {} as never, revalidate, { dedupe: true, retryCount: 2 });
    handler({}, 'notebook-key', {} as never, revalidate, { dedupe: true, retryCount: 3 });

    expect(schedule).toHaveBeenCalledTimes(2);
    expect(scheduled.map(({ delay }) => delay)).toEqual([5000, 15_000]);

    scheduled[0].callback();
    scheduled[1].callback();
    expect(revalidate).toHaveBeenNthCalledWith(1, { retryCount: 1 });
    expect(revalidate).toHaveBeenNthCalledWith(2, { retryCount: 2 });
  });

  it('applies plus or minus twenty percent jitter', () => {
    const delays: number[] = [];
    const low = createNotebookListRetryHandler({
      random: () => 0,
      schedule: (_callback, delay) => delays.push(delay),
    });
    const high = createNotebookListRetryHandler({
      random: () => 1,
      schedule: (_callback, delay) => delays.push(delay),
    });

    low({}, 'notebook-key', {} as never, vi.fn(), { dedupe: true, retryCount: 1 });
    high({}, 'notebook-key', {} as never, vi.fn(), { dedupe: true, retryCount: 1 });

    expect(delays).toEqual([4000, 6000]);
  });
});
