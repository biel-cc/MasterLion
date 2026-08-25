import { lambdaClient } from '@/libs/trpc/client';
import { ARCHIVE_BYPASS_IDENTIFIERS, truncateToolResult } from '@/server/utils/truncateToolResult';

interface ArchiveParams {
  agentId?: string | null;
  content: string;
  identifier?: string;
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  toolCallId?: string;
  topicId?: string | null;
}

const DEFAULT_ARCHIVE_TIMEOUT_MS = 3_000;

const toAbortError = (reason?: unknown) =>
  reason instanceof Error
    ? reason
    : Object.assign(new Error('Tool result archive cancelled'), { name: 'AbortError' });

export const archiveToolResultViaServer = async ({
  agentId,
  content,
  identifier,
  limit,
  signal,
  timeoutMs = DEFAULT_ARCHIVE_TIMEOUT_MS,
  toolCallId,
  topicId,
}: ArchiveParams): Promise<string> => {
  if (signal?.aborted) throw toAbortError(signal.reason);

  if (identifier && ARCHIVE_BYPASS_IDENTIFIERS.has(identifier)) {
    return content;
  }

  const fallback = truncateToolResult(content, limit);
  if (!content || !toolCallId || !topicId) {
    return fallback;
  }

  const requestController = new AbortController();
  const abortRequest = () => requestController.abort(toAbortError(signal?.reason));
  signal?.addEventListener('abort', abortRequest, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelWait: (() => void) | undefined;
  try {
    const request = lambdaClient.aiChat.archiveToolResult
      .mutate(
        {
          agentId,
          content,
          identifier,
          limit,
          toolCallId,
          topicId,
        },
        { signal: requestController.signal },
      )
      .then((outcome) => outcome.content);
    const deadline = new Promise<string>((resolve) => {
      timeout = setTimeout(
        () => {
          requestController.abort(
            Object.assign(new Error('Tool result archive timed out'), { name: 'TimeoutError' }),
          );
          resolve(fallback);
        },
        Math.max(0, timeoutMs),
      );
    });
    const cancellation = new Promise<never>((_, reject) => {
      cancelWait = () => reject(toAbortError(signal?.reason));
      signal?.addEventListener('abort', cancelWait, { once: true });
    });

    return await Promise.race([request, deadline, cancellation]);
  } catch {
    if (signal?.aborted) throw toAbortError(signal.reason);
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
    if (cancelWait) signal?.removeEventListener('abort', cancelWait);
  }
};
