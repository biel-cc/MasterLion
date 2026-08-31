import { TRPCError } from '@trpc/server';

const TRANSIENT_DATABASE_CODES = new Set([
  '08006',
  '57P01',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

const errorChain = (error: unknown) => {
  const chain: unknown[] = [];
  let current = error;

  while (current && chain.length < 6) {
    chain.push(current);
    current =
      typeof current === 'object' && current && 'cause' in current ? current.cause : undefined;
  }

  return chain;
};

const isTransientNotebookDatabaseError = (error: unknown) =>
  errorChain(error).some((item) => {
    if (typeof item !== 'object' || item === null) return false;

    const code = 'code' in item && typeof item.code === 'string' ? item.code : undefined;
    const message = 'message' in item && typeof item.message === 'string' ? item.message : '';

    return (
      (code ? TRANSIENT_DATABASE_CODES.has(code) : false) ||
      /connection refused|database system is starting up|terminating connection/i.test(message)
    );
  });

class NotebookDatabaseUnavailableCause extends Error {
  readonly data = { reason: 'DATABASE_RECOVERING' as const };

  constructor() {
    super('Notebook database is temporarily unavailable');
    this.name = 'NotebookDatabaseUnavailableCause';
  }
}

/** Convert only transient storage failures to a stable client retry signal. */
export const runNotebookDatabaseRead = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientNotebookDatabaseError(error)) throw error;

    throw new TRPCError({
      cause: new NotebookDatabaseUnavailableCause(),
      code: 'SERVICE_UNAVAILABLE',
      message: 'Notebook documents are temporarily unavailable',
    });
  }
};
