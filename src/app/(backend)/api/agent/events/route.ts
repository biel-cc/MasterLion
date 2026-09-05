import { TopicModel } from '@/database/models/topic';
import { createStreamEventManager } from '@/server/modules/AgentRuntime';

import { checkAuth } from '../../../middleware/auth';

/** Same-origin transport for server-owned device runs without an external Agent Gateway. */
export const GET = checkAuth(async (request, { serverDB, userId }) => {
  const params = new URL(request.url).searchParams;
  const operationId = params.get('operationId');
  const topicId = params.get('topicId');
  const cursor = request.headers.get('last-event-id') || params.get('lastEventId') || '0';
  if (!operationId || !topicId || !/^\d+(?:-\d+)?$/.test(cursor)) {
    return Response.json({ error: 'Invalid stream parameters' }, { status: 400 });
  }
  const topic = await new TopicModel(serverDB, userId).findById(topicId);
  const manager = createStreamEventManager();
  // The server clears runningOperation when it finishes. Its stream still needs
  // to be replayable when a slow first connection or reconnect arrives later.
  // The mutable topic reconnect pointer is not authorization evidence: clients
  // can update it. Only the owner recorded by runtime initialization is trusted.
  const ownsStream = topic && (await manager.getStreamOwner?.(operationId)) === userId;
  if (!ownsStream) {
    return Response.json({ error: 'Operation not found' }, { status: 404 });
  }

  const abort = new AbortController();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    abort.abort();
    clearInterval(heartbeat);
    request.signal.removeEventListener('abort', cleanup);
  };
  const stream = new ReadableStream<Uint8Array>({
    cancel: cleanup,
    start(controller) {
      request.signal.addEventListener('abort', cleanup, { once: true });
      if (request.signal.aborted) {
        cleanup();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(': connected\n\n'));
      heartbeat = setInterval(() => {
        if (!abort.signal.aborted) controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 30_000);
      // Both managers replay from the cursor before delivering new events. Do not
      // independently fetch history: that races with subscription and duplicates chunks.
      void manager
        .subscribeStreamEvents(
          operationId,
          cursor,
          (events) => {
            for (const event of events) {
              if (abort.signal.aborted) break;
              controller.enqueue(
                encoder.encode(
                  `${event.id ? `id: ${event.id}\n` : ''}data: ${JSON.stringify(event)}\n\n`,
                ),
              );
              if (event.type === 'agent_runtime_end') {
                cleanup();
                controller.close();
              }
            }
          },
          abort.signal,
        )
        .catch((error: unknown) => {
          if (!abort.signal.aborted) {
            cleanup();
            controller.error(error);
          }
        });
    },
  });
  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    },
  });
});
