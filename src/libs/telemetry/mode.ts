import type { TelemetryMode } from '@lobechat/types';

const DEFAULT_TELEMETRY_MODE: TelemetryMode = 'optional';

export const getTelemetryMode = (): TelemetryMode => {
  if (typeof window === 'undefined') return DEFAULT_TELEMETRY_MODE;

  return window.__SERVER_CONFIG__?.config.telemetry.mode ?? DEFAULT_TELEMETRY_MODE;
};

export const resolveTelemetryEnabled = (
  preference: boolean | null | undefined,
  mode: TelemetryMode = getTelemetryMode(),
) => {
  if (mode === 'required') return true;
  if (mode === 'disabled') return false;

  return Boolean(preference);
};
