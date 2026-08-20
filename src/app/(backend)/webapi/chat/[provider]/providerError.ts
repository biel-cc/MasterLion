const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const readNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const readNestedRecord = (value: unknown, key: string) => asRecord(asRecord(value)?.[key]);

const getFirstString = (...values: unknown[]) => {
  for (const value of values) {
    const result = readString(value);
    if (result) return result;
  }
};

const getFirstNumber = (...values: unknown[]) => {
  for (const value of values) {
    const result = readNumber(value);
    if (result !== undefined) return result;
  }
};

export interface SafeProviderError {
  code?: string;
  message: string;
  name: string;
  requestId?: string;
  status?: number;
  type?: string;
}

/**
 * Convert provider and transport failures into a JSON-safe diagnostic shape.
 * Only an explicit allow-list is copied so credentials, request bodies, and
 * provider response payloads can never leak through error serialization.
 */
export const serializeProviderError = (error: unknown): SafeProviderError => {
  const record = asRecord(error);
  const nestedError = readNestedRecord(error, 'error');
  const cause = readNestedRecord(error, 'cause');
  const nestedCauseError = readNestedRecord(cause, 'error');

  const message =
    getFirstString(
      record?.message,
      record?.errorMessage,
      nestedError?.message,
      nestedError?.errorMessage,
      cause?.message,
      nestedCauseError?.message,
      typeof error === 'string' ? error : undefined,
    ) || 'Unexpected provider error';

  const name = getFirstString(record?.name, cause?.name) || 'Error';
  const code = getFirstString(
    record?.code,
    record?.errorType,
    nestedError?.code,
    cause?.code,
    nestedCauseError?.code,
  );
  const type = getFirstString(record?.type, record?.errorType, nestedError?.type, cause?.type);
  const status = getFirstNumber(
    record?.status,
    record?.statusCode,
    nestedError?.status,
    cause?.status,
    cause?.statusCode,
  );
  const requestId = getFirstString(
    record?.request_id,
    record?.requestId,
    nestedError?.request_id,
    nestedError?.requestId,
    cause?.request_id,
    cause?.requestId,
  );

  return {
    ...(code ? { code } : {}),
    message,
    name,
    ...(requestId ? { requestId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(type ? { type } : {}),
  };
};
