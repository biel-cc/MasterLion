import debug from 'debug';

import {
  type StreamChunkData,
  type StreamEvent,
  stripFinalStateInEventData,
} from './StreamEventManager';
import { type IStreamEventManager, type PublishAgentRuntimeEndParams } from './types';

const log = debug('lobe-server:agent-runtime:in-memory-stream-event-manager');

const getDefaultReasonDetail = (finalState: any, reason?: string): string => {
  if (reason === 'error') {
    return finalState?.error?.message || finalState?.error?.type || 'Agent runtime failed';
  }

  if (reason === 'interrupted') {
    return finalState?.error?.message || 'Agent runtime interrupted';
  }

  return 'Agent runtime completed successfully';
};

type EventCallback = (events: StreamEvent[]) => void;

/**
 * In-Memory Stream Event Manager
 * In-memory implementation for testing and local development environments
 */
export class InMemoryStreamEventManager implements IStreamEventManager {
  private streams: Map<string, StreamEvent[]> = new Map();
  private owners = new Map<string, string>();
  private subscribers: Map<string, EventCallback[]> = new Map();
  private eventIdCounter = 0;

  private generateEventId(): string {
    this.eventIdCounter++;
    return `${Date.now()}-${this.eventIdCounter}`;
  }

  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    const eventId = this.generateEventId();

    const eventData: StreamEvent = {
      ...event,
      // Mirror the Redis-backed manager's chokepoint strip so in-memory
      // event shape stays identical to the production wire format —
      // tests run against this manager and would otherwise mask
      // regressions in the strip behaviour.
      data: stripFinalStateInEventData(event.data),
      id: eventId,
      operationId,
      timestamp: Date.now(),
    };

    // Get or create stream
    let stream = this.streams.get(operationId);
    if (!stream) {
      stream = [];
      this.streams.set(operationId, stream);
    }

    stream.push(eventData);

    // Limit stream length to prevent memory overflow
    if (stream.length > 1000) {
      stream.shift();
    }

    log('Published event %s for operation %s:%d', eventData.type, operationId, eventData.stepIndex);

    // Notify subscribers
    const callbacks = this.subscribers.get(operationId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback([eventData]);
        } catch (error) {
          console.error('[InMemoryStreamEventManager] Subscriber callback error:', error);
        }
      }
    }

    return eventId;
  }

  async publishStreamChunk(
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ): Promise<string> {
    return this.publishStreamEvent(operationId, {
      data: chunkData,
      stepIndex,
      type: 'stream_chunk',
    });
  }

  async getStreamOwner(operationId: string): Promise<string | undefined> {
    return this.owners.get(operationId);
  }

  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    if (typeof initialState?.userId === 'string') this.owners.set(operationId, initialState.userId);
    return this.publishStreamEvent(operationId, {
      data: initialState,
      stepIndex: 0,
      type: 'agent_runtime_init',
    });
  }

  async publishAgentRuntimeEnd({
    operationId,
    stepIndex,
    finalState,
    reason,
    reasonDetail,
    uiMessages,
  }: PublishAgentRuntimeEndParams): Promise<string> {
    // Strip happens centrally inside `publishStreamEvent`.
    return this.publishStreamEvent(operationId, {
      data: {
        finalState,
        operationId,
        phase: 'execution_complete',
        reason: reason || 'completed',
        reasonDetail: reasonDetail || getDefaultReasonDetail(finalState, reason),
        ...(uiMessages !== undefined && { uiMessages }),
      },
      stepIndex,
      type: 'agent_runtime_end',
    });
  }

  async getStreamHistory(operationId: string, count: number = 100): Promise<StreamEvent[]> {
    const stream = this.streams.get(operationId);
    if (!stream) {
      return [];
    }

    // Return most recent count events (in reverse order)
    return stream.slice(-count).reverse();
  }

  async cleanupOperation(operationId: string): Promise<void> {
    this.owners.delete(operationId);
    this.streams.delete(operationId);
    this.subscribers.delete(operationId);
    log('Cleaned up operation %s', operationId);
  }

  async getActiveOperationsCount(): Promise<number> {
    return this.streams.size;
  }

  async disconnect(): Promise<void> {
    // In-memory implementation doesn't need to disconnect
    log('InMemoryStreamEventManager disconnected');
  }

  /**
   * Subscribe to stream events (for SSE endpoint)
   * Compatible with Redis StreamEventManager.subscribeStreamEvents
   */
  async subscribeStreamEvents(
    operationId: string,
    lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let unsubscribe = () => {};
      const finish = () => {
        unsubscribe();
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      const deliver = (events: StreamEvent[]) => {
        if (signal?.aborted) return finish();
        onEvents(events);
        if (events.some((event) => event.type === 'agent_runtime_end')) finish();
      };
      if (signal?.aborted) return finish();
      unsubscribe = this.subscribe(operationId, deliver);
      signal?.addEventListener('abort', finish, { once: true });
      const [cursorTime, cursorSequence = 0] = lastEventId.split('-').map(Number);
      const history = (this.streams.get(operationId) ?? []).filter((event) => {
        const [time, sequence = 0] = (event.id ?? '0').split('-').map(Number);
        return time > cursorTime || (time === cursorTime && sequence > cursorSequence);
      });
      if (history.length) deliver(history);
    });
  }

  /**
   * Subscribe to stream events (for testing)
   */
  subscribe(operationId: string, callback: EventCallback): () => void {
    let callbacks = this.subscribers.get(operationId);
    if (!callbacks) {
      callbacks = [];
      this.subscribers.set(operationId, callbacks);
    }
    callbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.subscribers.get(operationId);
      if (cbs) {
        const index = cbs.indexOf(callback);
        if (index > -1) {
          cbs.splice(index, 1);
        }
      }
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.streams.clear();
    this.owners.clear();
    this.subscribers.clear();
    this.eventIdCounter = 0;
    log('All data cleared');
  }

  /**
   * Get all events (for test verification)
   */
  getAllEvents(operationId: string): StreamEvent[] {
    return this.streams.get(operationId) ?? [];
  }

  /**
   * Wait for a specific event type (for testing)
   */
  waitForEvent(
    operationId: string,
    eventType: StreamEvent['type'],
    timeout: number = 5000,
  ): Promise<StreamEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for event ${eventType}`));
      }, timeout);

      const unsubscribe = this.subscribe(operationId, (events) => {
        for (const event of events) {
          if (event.type === eventType) {
            clearTimeout(timer);
            unsubscribe();
            resolve(event);
            return;
          }
        }
      });

      // Check existing events
      const existingEvents = this.streams.get(operationId) ?? [];
      for (const event of existingEvents) {
        if (event.type === eventType) {
          clearTimeout(timer);
          unsubscribe();
          resolve(event);
          return;
        }
      }
    });
  }
}

/**
 * Singleton instance for testing and local development environments
 */
export const inMemoryStreamEventManager = new InMemoryStreamEventManager();
