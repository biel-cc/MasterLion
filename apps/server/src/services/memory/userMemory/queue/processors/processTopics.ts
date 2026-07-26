import { LayersEnum, MemorySourceType } from '@lobechat/types';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { isPersonalMemoryEnabled } from '@/server/services/memory/userMemory/access';

import {
  buildWorkflowPayloadInput,
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '../../extract';
import { type MemoryQueueContext } from '../context';
import { MemoryExtractionQueueService } from '../service';

const DEFAULT_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
  LayersEnum.Identity,
];

export const processTopicsHandler = async (
  context: MemoryQueueContext<MemoryExtractionPayloadInput>,
) => {
  const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

  if (!payload.userIds.length) {
    return {
      message: 'No user id provided for topic batch.',
      processedTopics: 0,
      processedUsers: 0,
    };
  }
  if (!payload.topicIds.length) {
    return {
      message: 'No topic ids provided for extraction.',
      processedTopics: 0,
      processedUsers: 0,
    };
  }
  if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
    return {
      message: 'Source not supported in topic batch.',
      processedTopics: 0,
      processedUsers: 0,
    };
  }
  if (payload.workspaceId) {
    return {
      message: 'Workspace memory extraction is disabled.',
      processedTopics: 0,
      processedUsers: 0,
    };
  }

  const userId = payload.userIds[0]!;
  const memoryEnabled = await context.run(
    `memory:user-memory:extract:users:${userId}:consent-check:topic-batch`,
    async () => {
      const db = await getServerDB();
      return isPersonalMemoryEnabled({ db, userId });
    },
  );
  if (!memoryEnabled) {
    return {
      message: 'Memory was disabled before topic batch processing.',
      processedTopics: 0,
      processedUsers: 0,
    };
  }

  if (payload.asyncTaskId) {
    const cancelled = await context.run(
      `memory:user-memory:extract:users:${userId}:cancel-check`,
      () =>
        getServerDB().then((db) =>
          new AsyncTaskModel(
            db,
            userId,
            payload.workspaceId,
          ).isUserMemoryExtractionCancellationRequested(payload.asyncTaskId!),
        ),
    );
    if (cancelled) {
      return {
        message: 'Memory extraction task cancellation requested, skip topic batch.',
        processedTopics: 0,
        processedUsers: 0,
      };
    }
  }

  const flow = await context.run(
    `memory:user-memory:extract:users:${userId}:schedule-topic-flow`,
    () =>
      MemoryExtractionQueueService.triggerTopicFlow(
        userId,
        buildWorkflowPayloadInput({
          ...payload,
          layers: payload.layers.length ? payload.layers : DEFAULT_LAYERS,
          userId,
          userIds: [userId],
        }),
      ),
  );

  return {
    flowJobId: flow.jobId,
    processedTopics: payload.topicIds.length,
    processedUsers: 1,
    topicJobIds: flow.topicJobIds,
  };
};
