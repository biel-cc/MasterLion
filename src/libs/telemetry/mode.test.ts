import { describe, expect, it } from 'vitest';

import { resolveTelemetryEnabled } from './mode';

describe('resolveTelemetryEnabled', () => {
  it('forces telemetry on in required mode', () => {
    expect(resolveTelemetryEnabled(false, 'required')).toBe(true);
  });

  it('forces telemetry off in disabled mode', () => {
    expect(resolveTelemetryEnabled(true, 'disabled')).toBe(false);
  });

  it('uses the user preference in optional mode', () => {
    expect(resolveTelemetryEnabled(true, 'optional')).toBe(true);
    expect(resolveTelemetryEnabled(false, 'optional')).toBe(false);
  });
});
