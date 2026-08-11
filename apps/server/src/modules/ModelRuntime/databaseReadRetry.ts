const TRANSIENT_DATABASE_CODES = new Set(['08006', '57P01', '57P03']);

export class ModelProviderConfigurationUnavailableError extends Error {
  readonly retryable = true;

  constructor() {
    super('Model provider configuration is temporarily unavailable; please retry');
    this.name = 'ModelProviderConfigurationUnavailableError';
  }
}

const errorChain = (error: unknown) => {
  const chain: unknown[] = [];
  let current = error;

  while (current && chain.length < 5) {
    chain.push(current);
    current =
      typeof current === 'object' && current && 'cause' in current ? current.cause : undefined;
  }

  return chain;
};

export const isTransientDatabaseReadError = (error: unknown) =>
  errorChain(error).some((item) => {
    if (!(item instanceof Error) && (typeof item !== 'object' || item === null)) return false;

    const code = 'code' in item && typeof item.code === 'string' ? item.code : undefined;
    const message = 'message' in item && typeof item.message === 'string' ? item.message : '';

    return (
      (code ? TRANSIENT_DATABASE_CODES.has(code) : false) ||
      /connection refused|econnrefused|the database system is starting up|terminating connection/i.test(
        message,
      )
    );
  });

export const withTransientDatabaseReadRetry = async <T>(
  operation: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<T> => {
  const delaysMs = options.delaysMs || [200, 600, 1200];
  const sleep =
    options.sleep ||
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const delay = delaysMs[attempt];

      if (!isTransientDatabaseReadError(error)) throw error;
      if (delay === undefined) throw new ModelProviderConfigurationUnavailableError();

      await sleep(delay);
    }
  }
};
