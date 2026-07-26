import { chunk } from 'es-toolkit/compat';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { type ListUsersForMemoryExtractorCursor } from '@/database/models/user';
import { getServerDB } from '@/database/server';

import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '../../extract';
import { type MemoryQueueContext } from '../context';
import { MemoryExtractionQueueService } from '../service';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;

export const processUsersHandler = async (
  context: MemoryQueueContext<MemoryExtractionPayloadInput>,
) => {
  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  if (params.sources.length === 0) {
    return { message: 'No sources provided, skip memory extraction.' };
  }
  if (params.workspaceId) {
    return { message: 'Workspace memory extraction is disabled.' };
  }
  if (params.asyncTaskId && params.userIds[0]) {
    // NOTICE: Cooperative cascading cancellation for the workflow tree.
    // If root task has cancelRequestedAt, this stage stops scheduling child workflows.
    const cancelled = await context.run('memory:user-memory:extract:cancel-check:root', () =>
      getServerDB().then((db) =>
        new AsyncTaskModel(
          db,
          params.userIds[0]!,
          params.workspaceId,
        ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
      ),
    );
    if (cancelled) {
      return { message: 'Memory extraction task cancellation requested, skip processing users.' };
    }
  }

  const executor = await MemoryExtractionExecutor.create();

  // Redis queue payloads are plain JSON, so cursor dates need to be restored.
  const userCursor = params.userCursor
    ? { createdAt: new Date(params.userCursor.createdAt), id: params.userCursor.id }
    : undefined;

  const userBatch = await context.run<{
    cursor?: ListUsersForMemoryExtractorCursor;
    ids: string[];
  }>('memory:user-memory:extract:get-users', () =>
    params.userIds.length > 0
      ? Promise.resolve({ ids: params.userIds })
      : executor.getUsers(USER_PAGE_SIZE, userCursor),
  );

  const ids = userBatch.ids;
  if (ids.length === 0) {
    return { message: 'No users to process for memory extraction.' };
  }

  const cursor = userBatch.cursor;

  const batches = chunk(ids, USER_BATCH_SIZE);
  await Promise.all(
    batches.map((userIds) =>
      context.run(`memory:user-memory:extract:users:process-topic-batches`, () =>
        MemoryExtractionQueueService.triggerProcessUserTopics({
          ...buildWorkflowPayloadInput(params),
          topicCursor: undefined,
          userId: userIds[0],
          userIds,
        }),
      ),
    ),
  );

  if (params.userIds.length === 0 && cursor) {
    await context.run('memory:user-memory:extract:users:schedule-next-user-batch', () =>
      MemoryExtractionQueueService.triggerProcessUsers({
        ...buildWorkflowPayloadInput({
          ...params,
          userCursor: { createdAt: cursor.createdAt.toISOString(), id: cursor.id },
        }),
      }),
    );
  }

  return {
    batches: batches.length,
    nextCursor: cursor ? cursor.id : null,
    processedUsers: ids.length,
  };
};
