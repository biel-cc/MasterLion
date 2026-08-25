import type { ToolCallRetryPolicy } from './ToolCallLifecycle';

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

const valueAt = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

export const isRetryableToolCallTransportError = (error: unknown): boolean => {
  const name = valueAt(error, 'name');
  if (name === 'AbortError') return false;

  const status = valueAt(valueAt(error, 'data'), 'httpStatus');
  if (typeof status === 'number') return RETRYABLE_HTTP_STATUSES.has(status);

  const directCode = valueAt(error, 'code');
  const cause = valueAt(error, 'cause');
  const causeCode = valueAt(cause, 'code');
  if (
    (typeof directCode === 'string' && RETRYABLE_NETWORK_CODES.has(directCode)) ||
    (typeof causeCode === 'string' && RETRYABLE_NETWORK_CODES.has(causeCode))
  ) {
    return true;
  }

  const message = valueAt(error, 'message');
  return (
    typeof message === 'string' &&
    /failed to fetch|network error|network request failed|socket hang up/i.test(message)
  );
};

const abortableSleep = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('Tool call retry cancelled'), { name: 'AbortError' }));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('Tool call retry cancelled'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const createDefaultToolCallRetryPolicy = (): ToolCallRetryPolicy => ({
  attemptTimeoutMs: 10_000,
  clock: {
    now: Date.now,
    sleep: abortableSleep,
  },
  delaysMs: [0, 3000, 5000, 8000, 15_000],
  isRetryable: isRetryableToolCallTransportError,
  jitterRatio: 0.2,
  random: Math.random,
  totalTimeoutMs: 45_000,
});
