import { MemorySourceType } from '@lobechat/types';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { type ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import { getServerDB } from '@/database/server';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';
import { forEachBatchSequential } from '@/server/services/memory/userMemory/topicBatching';

import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '../../extract';
import { type MemoryQueueContext } from '../context';
import { MemoryExtractionQueueService } from '../service';

const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;

export const processUserTopicsHandler = async (
  context: MemoryQueueContext<MemoryExtractionPayloadInput>,
) => {
  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  if (!params.userIds.length) {
    return { message: 'No user ids provided for topic processing.' };
  }
  if (!params.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'No supported sources requested, skip topic processing.' };
  }
  if (params.workspaceId) {
    return { message: 'Workspace memory extraction is disabled.' };
  }

  const executor = await MemoryExtractionExecutor.create();

  const scheduleNextPage = async (userId: string, cursorCreatedAt: Date, cursorId: string) => {
    await MemoryExtractionQueueService.triggerProcessUserTopics({
      ...buildWorkflowPayloadInput({
        ...params,
        topicCursor: {
          createdAt: cursorCreatedAt.toISOString(),
          id: cursorId,
          userId,
        },
        topicIds: [],
        userId,
        userIds: [userId],
      }),
    });
  };

  for (const userId of params.userIds) {
    const memoryEnabled = await context.run(
      `memory:user-memory:extract:users:${userId}:consent-check`,
      async () => {
        const db = await getServerDB();
        return isPersonalMemoryEnabled({ db, userId });
      },
    );
    if (!memoryEnabled) continue;

    if (params.asyncTaskId) {
      // NOTICE: Cooperative cascading cancellation for the workflow tree.
      // A cancelled root task should stop at user-topic pagination and avoid enqueuing topic batches.
      const cancelled = await context.run(
        `memory:user-memory:extract:users:${userId}:cancel-check`,
        () =>
          getServerDB().then((db) =>
            new AsyncTaskModel(
              db,
              userId,
              params.workspaceId,
            ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
          ),
      );
      if (cancelled) {
        continue;
      }
    }

    const topicCursor =
      params.topicCursor && params.topicCursor.userId === userId
        ? {
            createdAt: new Date(params.topicCursor.createdAt),
            id: params.topicCursor.id,
          }
        : undefined;

    const topicsFromPayload =
      params.topicIds && params.topicIds.length > 0
        ? await context.run(
            `memory:user-memory:extract:users:${userId}:filter-topic-ids`,
            async () => {
              const filtered = await executor.filterTopicIdsForUser(
                userId,
                params.topicIds,
                params.workspaceId,
              );
              return filtered.length > 0 ? filtered : undefined;
            },
          )
        : undefined;

    const topicBatch = await context.run<{
      cursor?: ListTopicsForMemoryExtractorCursor;
      ids: string[];
    }>(`memory:user-memory:extract:users:${userId}:list-topics:${topicCursor?.id || 'root'}`, () =>
      topicsFromPayload && topicsFromPayload.length > 0
        ? Promise.resolve({ ids: topicsFromPayload })
        : executor.getTopicsForUser(
            {
              cursor: topicCursor,
              forceAll: params.forceAll,
              forceTopics: params.forceTopics,
              from: params.from,
              to: params.to,
              userId,
              workspaceId: params.workspaceId,
            },
            TOPIC_PAGE_SIZE,
          ),
    );

    const ids = topicBatch.ids;
    if (!ids.length) {
      continue;
    }

    const cursor = 'cursor' in topicBatch ? topicBatch.cursor : undefined;

    await forEachBatchSequential(ids, TOPIC_BATCH_SIZE, async (topicIds, batchIndex) => {
      await context.run(
        `memory:user-memory:extract:users:${userId}:process-topics-batch:${batchIndex}`,
        () =>
          MemoryExtractionQueueService.triggerProcessTopics(userId, {
            ...buildWorkflowPayloadInput(params),
            topicCursor: undefined,
            topicIds,
            userId,
            userIds: [userId],
          }),
      );
    });

    if (!topicsFromPayload && cursor) {
      await context.run(
        `memory:user-memory:extract:users:${userId}:topics:${cursor.id}:schedule-next-batch`,
        () => {
          // Redis queue payloads are plain JSON, so cursor dates need to be restored.
          const createdAt = new Date(cursor.createdAt);
          if (Number.isNaN(createdAt.getTime())) {
            throw new Error('Invalid cursor date when scheduling next topic page');
          }

          return scheduleNextPage(userId, createdAt, cursor.id);
        },
      );
    }
  }

  return { processedUsers: params.userIds.length };
};
