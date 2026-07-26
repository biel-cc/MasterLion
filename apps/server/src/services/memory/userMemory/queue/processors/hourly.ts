import { MemorySourceType } from '@lobechat/types';
import { chunk } from 'es-toolkit/compat';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionHourlyWorkflowPayload,
  normalizeMemoryExtractionPayload,
} from '../../extract';
import { type MemoryQueueContext } from '../context';
import { MemoryExtractionQueueService } from '../service';

const USER_PAGE_SIZE = 200;
const USER_BATCH_SIZE = 20;

export const hourlyWorkflowHandler = async (
  context: MemoryQueueContext<MemoryExtractionHourlyWorkflowPayload>,
) => {
  const { cursor, dryRun } = context.requestPayload || {};

  const parsedCursor = cursor
    ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
    : undefined;
  if (parsedCursor && Number.isNaN(parsedCursor.createdAt.getTime())) {
    throw new Error('Invalid cursor date for hourly memory extraction workflow');
  }

  const executor = await MemoryExtractionExecutor.create();
  const userBatch = await context.run(
    `memory:user-memory:hourly:list-users:${parsedCursor?.id || 'root'}`,
    () => executor.getUsersForHourlyExtraction(USER_PAGE_SIZE, parsedCursor),
  );

  const nextCursor = userBatch.cursor
    ? {
        createdAt: userBatch.cursor.createdAt.toISOString(),
        id: userBatch.cursor.id,
      }
    : undefined;

  const userIds = await context.run(
    `memory:user-memory:hourly:filter-runtime-rollout:${parsedCursor?.id || 'root'}`,
    async () => {
      const checks = await Promise.all(
        userBatch.ids.map(async (userId) => ({
          enabled:
            (await getServerFeatureFlagsStateFromRuntimeConfig(userId)).enableMemory === true,
          userId,
        })),
      );

      return checks.filter((item) => item.enabled).map((item) => item.userId);
    },
  );

  if (userIds.length === 0) {
    if (nextCursor) {
      await context.run('memory:user-memory:hourly:schedule-next-page', () =>
        MemoryExtractionQueueService.triggerHourly({
          cursor: nextCursor,
          dryRun,
          queueRunId: context.requestPayload.queueRunId,
        }),
      );
    }

    return {
      hasNextPage: !!nextCursor,
      message: 'No eligible users for hourly memory extraction.',
      processedUsers: 0,
    };
  }

  if (!dryRun) {
    const batches = chunk(userIds, USER_BATCH_SIZE);
    await Promise.all(
      batches.map((batchUserIds, index) =>
        context.run(`memory:user-memory:hourly:trigger-users:${index}`, () =>
          MemoryExtractionQueueService.triggerProcessUsers(
            buildWorkflowPayloadInput(
              normalizeMemoryExtractionPayload({
                mode: 'workflow',
                queueRunId: context.requestPayload.queueRunId,
                sources: [MemorySourceType.ChatTopic],
                userIds: batchUserIds,
              }),
            ),
          ),
        ),
      ),
    );
  }

  if (nextCursor) {
    await context.run('memory:user-memory:hourly:schedule-next-page', () =>
      MemoryExtractionQueueService.triggerHourly({
        cursor: nextCursor,
        dryRun,
        queueRunId: context.requestPayload.queueRunId,
      }),
    );
  }

  return {
    dryRun: !!dryRun,
    hasNextPage: !!nextCursor,
    processedUsers: userIds.length,
    scheduledBatches: dryRun ? 0 : chunk(userIds, USER_BATCH_SIZE).length,
  };
};
