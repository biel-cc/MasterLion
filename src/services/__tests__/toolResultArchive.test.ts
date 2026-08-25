import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { archiveToolResultViaServer } from '../toolResultArchive';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiChat: {
      archiveToolResult: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('archiveToolResultViaServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a bounded local fallback when the archive request never settles', async () => {
    vi.useFakeTimers();
    vi.mocked(lambdaClient.aiChat.archiveToolResult.mutate).mockReturnValue(new Promise(() => {}));

    const pending = archiveToolResultViaServer({
      content: 'raw result',
      identifier: 'lobe-local-system',
      timeoutMs: 25,
      toolCallId: 'call-1',
      topicId: 'topic-1',
    });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toBe('raw result');
    expect(lambdaClient.aiChat.archiveToolResult.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'raw result', toolCallId: 'call-1' }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it('propagates explicit cancellation instead of converting it into a fallback', async () => {
    vi.mocked(lambdaClient.aiChat.archiveToolResult.mutate).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = archiveToolResultViaServer({
      content: 'raw result',
      signal: controller.signal,
      timeoutMs: 60_000,
      toolCallId: 'call-1',
      topicId: 'topic-1',
    });

    controller.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
