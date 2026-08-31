import type { SWRConfiguration } from 'swr';

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 502, 503, 504]);
const RETRYABLE_TRANSPORT_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ETIMEDOUT',
]);
const RETRY_DELAYS_MS = [5000, 15_000] as const;

const errorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current = error;

  while (current && chain.length < 6) {
    chain.push(current);
    current =
      typeof current === 'object' && current && 'cause' in current ? current.cause : undefined;
  }

  return chain;
};

const readObject = (value: unknown): Record<string, any> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, any>) : undefined;

export const isRetryableNotebookListError = (error: unknown): boolean => {
  const chain = errorChain(error);

  if (
    chain.some((item) => {
      const value = readObject(item);
      return value?.name === 'AbortError' || value?.meta?.shouldRetry === false;
    })
  ) {
    return false;
  }

  return chain.some((item) => {
    const value = readObject(item);
    if (!value) return false;

    const data = readObject(value.data);
    const shapeData = readObject(readObject(value.shape)?.data);
    const httpStatus = data?.httpStatus ?? shapeData?.httpStatus ?? value.status;
    const reason =
      readObject(data?.errorData)?.reason ??
      readObject(shapeData?.errorData)?.reason ??
      value.reason;

    if (reason === 'DATABASE_RECOVERING') return true;
    if (typeof httpStatus === 'number') return RETRYABLE_HTTP_STATUS.has(httpStatus);
    if (typeof value.code === 'string' && RETRYABLE_TRANSPORT_CODES.has(value.code)) return true;

    return value instanceof TypeError || value.name === 'TypeError';
  });
};

type RetryHandler = NonNullable<SWRConfiguration['onErrorRetry']>;

export const createNotebookListRetryHandler = (
  dependencies: {
    random?: () => number;
    schedule?: (callback: () => void, delay: number) => unknown;
  } = {},
): RetryHandler => {
  const random = dependencies.random ?? Math.random;
  const schedule = dependencies.schedule ?? ((callback, delay) => setTimeout(callback, delay));

  return (_error, _key, _config, revalidate, { retryCount }) => {
    const baseDelay = RETRY_DELAYS_MS[retryCount - 1];
    if (baseDelay === undefined) return;

    const jitterMultiplier = 0.8 + random() * 0.4;
    const delay = Math.round(baseDelay * jitterMultiplier);

    schedule(() => revalidate({ retryCount }), delay);
  };
};

export const notebookListRetryHandler = createNotebookListRetryHandler();
