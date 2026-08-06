import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { appEnv } from '@/envs/app';
import { appendProductTelemetryRecord } from '@/server/services/productTelemetry';

const MAX_REQUEST_BYTES = 32 * 1024;
const eventSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    occurredAt: z.string().datetime().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    traceId: z.string().trim().min(1).max(128).optional(),
    workspaceId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const readBody = async (request: Request) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_REQUEST_BYTES) throw new Error('too_large');

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) throw new Error('too_large');
  return body;
};

export const POST = checkAuth(async (request: Request, { userId }) => {
  if (appEnv.TELEMETRY_MODE === 'disabled') return new Response(null, { status: 204 });

  try {
    const parsed = eventSchema.safeParse(JSON.parse(await readBody(request)));
    if (!parsed.success)
      return Response.json({ error: 'Invalid telemetry event' }, { status: 400 });

    const now = new Date().toISOString();
    try {
      await appendProductTelemetryRecord({
        eventId: randomUUID(),
        name: parsed.data.name,
        occurredAt: parsed.data.occurredAt || now,
        properties: parsed.data.properties,
        receivedAt: now,
        traceId: parsed.data.traceId,
        userId,
        workspaceId: parsed.data.workspaceId,
      });
    } catch (error) {
      console.error('Failed to persist product telemetry event:', error);
    }

    // The telemetry sink is deliberately fail-open: product use must never depend on SLS.
    return new Response(null, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === 'too_large') {
      return Response.json({ error: 'Telemetry event is too large' }, { status: 413 });
    }
    return Response.json({ error: 'Telemetry request must contain valid JSON' }, { status: 400 });
  }
});
