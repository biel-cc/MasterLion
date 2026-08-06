import { appendFile } from 'node:fs/promises';

import { appEnv } from '@/envs/app';

const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|credential|api[-_]?key|access[-_]?key|private[-_]?key|base64|binary|bytes|file[-_]?content/i;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LENGTH = 1024;
const AUTHORIZATION_TEXT_VALUE = /\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi;
const SENSITIVE_TEXT_VALUE =
  /\b(cookie|api[-_ ]?key|access[-_ ]?key|password|token)\s*[:=]\s*([^\s,;]+)/gi;

interface SanitizeTelemetryOptions {
  maxArrayItems?: number;
  maxDepth?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

export interface ProductTelemetryRecord {
  eventId: string;
  name: string;
  occurredAt: string;
  properties?: Record<string, unknown>;
  receivedAt: string;
  traceId?: string;
  userId: string;
  workspaceId?: string;
}

export const sanitizeTelemetryValue = (
  value: unknown,
  options: SanitizeTelemetryOptions = {},
  depth = 0,
): unknown => {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxArrayItems = options.maxArrayItems ?? MAX_ARRAY_ITEMS;
  const maxObjectKeys = options.maxObjectKeys ?? MAX_OBJECT_KEYS;
  const maxStringLength = options.maxStringLength ?? MAX_STRING_LENGTH;
  if (depth > maxDepth || value === null) return value === null ? null : '[truncated]';
  if (typeof value === 'string') {
    if (/^data:[^;]+;base64,/i.test(value)) return '[binary omitted]';
    return value
      .replaceAll(AUTHORIZATION_TEXT_VALUE, 'Authorization=[redacted]')
      .replaceAll(SENSITIVE_TEXT_VALUE, (_match, label: string) => `${label}=[redacted]`)
      .slice(0, maxStringLength);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary omitted]';
  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) => sanitizeTelemetryValue(item, options, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .slice(0, maxObjectKeys)
        .map(([key, item]) => [key, sanitizeTelemetryValue(item, options, depth + 1)]),
    );
  }
  return undefined;
};

export const appendProductTelemetryRecord = async (record: ProductTelemetryRecord) => {
  if (!appEnv.SLS_PRODUCT_EVENTS_FILE) return false;

  const sanitized = sanitizeTelemetryValue(record) as ProductTelemetryRecord;
  await appendFile(appEnv.SLS_PRODUCT_EVENTS_FILE, `${JSON.stringify(sanitized)}\n`, {
    encoding: 'utf8',
    flag: 'a',
  });
  return true;
};
