// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTraceOptions } from './trace';

const mocks = vi.hoisted(() => ({
  createTrace: vi.fn(),
  generation: vi.fn(),
  generationUpdate: vi.fn(),
  shutdownAsync: vi.fn(),
  traceUpdate: vi.fn(),
}));

vi.mock('@/libs/traces', () => ({
  TraceClient: vi.fn().mockImplementation(() => ({
    createTrace: mocks.createTrace,
    shutdownAsync: mocks.shutdownAsync,
  })),
}));

vi.mock('next/server', () => ({ after: vi.fn((callback) => callback()) }));

describe('createTraceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generation.mockReturnValue({ id: 'observation-1', update: mocks.generationUpdate });
    mocks.createTrace.mockReturnValue({
      generation: mocks.generation,
      id: 'trace-1',
      update: mocks.traceUpdate,
    });
  });

  it('records failed generations and flushes the trace', async () => {
    const options = createTraceOptions(
      { messages: [{ content: 'hello', role: 'user' }], model: 'deepseek-v4-flash' },
      {
        provider: 'newapi',
        shutdownMode: 'immediate',
        trace: { enabled: true, traceId: 'trace-1', userId: 'user-1' },
      },
    );

    await options.callback.onError?.({ message: 'socket hang up' });
    await options.callback.onFinal?.({} as any);

    expect(mocks.generationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        endTime: expect.any(Date),
        level: 'ERROR',
        output: { error: 'socket hang up' },
        statusMessage: 'socket hang up',
      }),
    );
    expect(mocks.traceUpdate).toHaveBeenCalledWith({ output: { error: 'socket hang up' } });
    expect(mocks.shutdownAsync).toHaveBeenCalledOnce();
  });
});
