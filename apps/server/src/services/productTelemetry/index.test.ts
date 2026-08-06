import { describe, expect, it } from 'vitest';

import { sanitizeTelemetryValue } from './index';

describe('sanitizeTelemetryValue', () => {
  it('removes credentials recursively while retaining safe correlation fields', () => {
    expect(
      sanitizeTelemetryValue({
        authorization: 'Bearer secret',
        nested: { apiKey: 'secret', model: 'gpt-test' },
        traceId: 'trace-1',
      }),
    ).toEqual({ nested: { model: 'gpt-test' }, traceId: 'trace-1' });
  });

  it('bounds strings and arrays', () => {
    const value = sanitizeTelemetryValue({
      items: Array.from({ length: 30 }, (_, i) => i),
      text: 'x'.repeat(1100),
    });
    expect((value as any).items).toHaveLength(20);
    expect((value as any).text).toHaveLength(1024);
  });

  it('omits binary payloads and data URLs', () => {
    expect(sanitizeTelemetryValue(new Uint8Array([1, 2]))).toBe('[binary omitted]');
    expect(sanitizeTelemetryValue('data:image/png;base64,AAAA')).toBe('[binary omitted]');
  });

  it('redacts credential values embedded in text', () => {
    expect(sanitizeTelemetryValue('Authorization: Bearer secret Cookie=session-secret')).toBe(
      'Authorization=[redacted] Cookie=[redacted]',
    );
  });
});
