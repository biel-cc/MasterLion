import { API_ENDPOINTS } from './_url';

export interface ProductTelemetryEvent {
  name: string;
  occurredAt?: string;
  properties?: Record<string, unknown>;
  traceId?: string;
  workspaceId?: string;
}

export const submitProductTelemetryEvent = async (event: ProductTelemetryEvent) => {
  try {
    const response = await fetch(API_ENDPOINTS.telemetryEvents, {
      body: JSON.stringify(event),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });

    return response.ok;
  } catch {
    return false;
  }
};
