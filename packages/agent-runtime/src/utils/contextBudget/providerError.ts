const LIMIT_FIELDS = [
  'contextWindow',
  'contextWindowTokens',
  'context_window',
  'context_window_tokens',
  'limit',
  'maxContextLength',
  'maximumContextLength',
  'max_context_length',
] as const;

const CONTEXT_ERROR_CODES = new Set([
  'context_length_exceeded',
  'ExceededContextWindow',
  'exceeded_context_window',
]);

const toPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value === 'string' && /^\s*[\d,]+\s*$/.test(value)) {
    value = Number(value.replaceAll(',', ''));
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
};

const recordsInErrorChain = (error: unknown): Record<string, unknown>[] => {
  const records: Record<string, unknown>[] = [];
  let current = error;

  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const record = current as Record<string, unknown>;
    records.push(record);
    current = record.cause ?? record.error;
  }

  return records;
};

const observedLimitFromMessage = (message: string): number | undefined => {
  const patterns = [
    /maximum context length is\s*([\d,]+)\s*tokens/i,
    /context (?:length|limit|window)\D{0,32}([\d,]+)\s*tokens/i,
    /limit(?: is| of|=|:)?\s*([\d,]+)\s*tokens/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = toPositiveInteger(match?.[1]);
    if (value) return value;
  }

  return undefined;
};

export interface ExceededContextWindowErrorInfo {
  kind: 'exceeded-context-window';
  observedLimitTokens?: number;
}

/** Parse provider context-limit failures without copying provider text into trace records. */
export const parseExceededContextWindowError = (
  error: unknown,
): ExceededContextWindowErrorInfo | undefined => {
  const records = recordsInErrorChain(error);
  const messages: string[] = [];
  let isContextError = false;

  for (const record of records) {
    const code = record.code ?? record.type ?? record.name;
    if (typeof code === 'string' && CONTEXT_ERROR_CODES.has(code)) isContextError = true;

    if (typeof record.message === 'string') {
      messages.push(record.message);
      if (
        /maximum context length/i.test(record.message) ||
        /context.{0,32}(?:exceed|too (?:large|long)|maximum|limit|window)/i.test(record.message)
      ) {
        isContextError = true;
      }
    }

    for (const field of LIMIT_FIELDS) {
      const observedLimitTokens = toPositiveInteger(record[field]);
      if (observedLimitTokens && isContextError) {
        return { kind: 'exceeded-context-window', observedLimitTokens };
      }
    }
  }

  if (!isContextError) return undefined;

  for (const message of messages) {
    const observedLimitTokens = observedLimitFromMessage(message);
    if (observedLimitTokens) return { kind: 'exceeded-context-window', observedLimitTokens };
  }

  return { kind: 'exceeded-context-window' };
};
