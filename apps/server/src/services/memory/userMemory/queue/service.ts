import { createHash, randomUUID } from 'node:crypto';

import { FlowProducer, type JobsOptions, Queue } from 'bullmq';

import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
} from '../extract';
import {
  createMemoryQueueProducerConnection,
  getMemoryQueuePrefix,
  requireMemoryQueueRedisUrl,
} from './connection';
import {
  MEMORY_QUEUE_DEFAULT_JOB_OPTIONS,
  MEMORY_QUEUE_HOURLY_SCHEDULER_ID,
  MEMORY_QUEUE_JOB_NAMES,
  MEMORY_QUEUE_NAME,
  type MemoryQueueJobName,
} from './constants';
import type { MemoryPersonaQueuePayload, MemoryQueueJobData } from './types';

const stableHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

const safeJobId = (runId: string, jobName: MemoryQueueJobName, discriminator: unknown) =>
  [runId, jobName, stableHash(discriminator)]
    .join('-')
    .replaceAll(':', '-')
    .replaceAll(/\s+/g, '-');

const withQueueRunId = <T extends { asyncTaskId?: string; queueRunId?: string }>(payload: T) => ({
  ...payload,
  queueRunId: payload.queueRunId || payload.asyncTaskId || randomUUID(),
});

let memoryQueue: Queue<MemoryQueueJobData, unknown, string> | undefined;
let memoryFlowProducer: FlowProducer | undefined;

const getMemoryQueue = () => {
  requireMemoryQueueRedisUrl();

  if (!memoryQueue) {
    memoryQueue = new Queue<MemoryQueueJobData, unknown, string>(MEMORY_QUEUE_NAME, {
      connection: createMemoryQueueProducerConnection(),
      defaultJobOptions: MEMORY_QUEUE_DEFAULT_JOB_OPTIONS,
      prefix: getMemoryQueuePrefix(),
    });
  }

  return memoryQueue;
};

const getMemoryFlowProducer = () => {
  requireMemoryQueueRedisUrl();

  if (!memoryFlowProducer) {
    memoryFlowProducer = new FlowProducer({
      connection: createMemoryQueueProducerConnection(),
      prefix: getMemoryQueuePrefix(),
    });
  }

  return memoryFlowProducer;
};

const addJob = async <T extends MemoryQueueJobData>(
  jobName: MemoryQueueJobName,
  payload: T & { asyncTaskId?: string; queueRunId?: string },
  discriminator: unknown,
  options?: JobsOptions,
) => {
  const data = withQueueRunId(payload);
  const jobId = safeJobId(data.queueRunId, jobName, discriminator);
  const job = await getMemoryQueue().add(jobName, data, { ...options, jobId });

  return { jobId: job.id || jobId, queueRunId: data.queueRunId };
};

export class MemoryExtractionQueueService {
  static triggerProcessUsers(payload: MemoryExtractionPayloadInput) {
    return addJob(MEMORY_QUEUE_JOB_NAMES.processUsers, payload, {
      cursor: payload.userCursor,
      userIds: payload.userIds,
    });
  }

  static triggerHourly(payload: MemoryExtractionHourlyWorkflowPayload) {
    return addJob(MEMORY_QUEUE_JOB_NAMES.hourly, payload, {
      cursor: payload.cursor,
      dryRun: payload.dryRun,
    });
  }

  static triggerProcessUserTopics(payload: MemoryExtractionPayloadInput) {
    return addJob(MEMORY_QUEUE_JOB_NAMES.processUserTopics, payload, {
      cursor: payload.topicCursor,
      userIds: payload.userIds,
    });
  }

  static triggerProcessTopics(userId: string, payload: MemoryExtractionPayloadInput) {
    return addJob(MEMORY_QUEUE_JOB_NAMES.processTopics, payload, {
      topicIds: payload.topicIds,
      userId,
    });
  }

  static triggerPersonaUpdate(
    userId: string,
    options?: { asyncTaskId?: string; queueRunId?: string },
  ) {
    const payload: MemoryPersonaQueuePayload = {
      asyncTaskId: options?.asyncTaskId,
      queueRunId: options?.queueRunId,
      userIds: [userId],
    };

    return addJob(MEMORY_QUEUE_JOB_NAMES.personaUpdate, payload, { userId });
  }

  static async triggerTopicFlow(userId: string, payload: MemoryExtractionPayloadInput) {
    const data = withQueueRunId(payload);
    const topicIds = data.topicIds || [];
    if (topicIds.length === 0) {
      throw new Error('At least one topic id is required to create a memory topic flow');
    }
    const parentJobId = safeJobId(data.queueRunId, MEMORY_QUEUE_JOB_NAMES.personaUpdate, {
      topicIds,
      userId,
    });

    const flow = await getMemoryFlowProducer().add({
      children: topicIds.map((topicId) => ({
        data: {
          ...data,
          topicIds: [topicId],
          userId,
          userIds: [userId],
        },
        name: MEMORY_QUEUE_JOB_NAMES.processTopic,
        opts: {
          ...MEMORY_QUEUE_DEFAULT_JOB_OPTIONS,
          attempts: 1,
          ignoreDependencyOnFailure: true,
          jobId: safeJobId(data.queueRunId, MEMORY_QUEUE_JOB_NAMES.processTopic, {
            topicId,
            userId,
          }),
        },
        queueName: MEMORY_QUEUE_NAME,
      })),
      data: {
        asyncTaskId: data.asyncTaskId,
        queueRunId: data.queueRunId,
        userIds: [userId],
      } satisfies MemoryPersonaQueuePayload,
      name: MEMORY_QUEUE_JOB_NAMES.personaUpdate,
      opts: {
        ...MEMORY_QUEUE_DEFAULT_JOB_OPTIONS,
        jobId: parentJobId,
      },
      queueName: MEMORY_QUEUE_NAME,
    });

    return {
      jobId: flow.job.id || parentJobId,
      queueRunId: data.queueRunId,
      topicJobIds: flow.children?.map((child) => child.job.id).filter(Boolean) || [],
    };
  }

  static async ensureHourlyScheduler() {
    return getMemoryQueue().upsertJobScheduler(
      MEMORY_QUEUE_HOURLY_SCHEDULER_ID,
      { pattern: '0 * * * *' },
      {
        data: { dryRun: false },
        name: MEMORY_QUEUE_JOB_NAMES.hourly,
        opts: MEMORY_QUEUE_DEFAULT_JOB_OPTIONS,
      },
    );
  }

  static async disableHourlyScheduler() {
    return getMemoryQueue().removeJobScheduler(MEMORY_QUEUE_HOURLY_SCHEDULER_ID);
  }

  static async cancelTask(taskId: string) {
    const jobs = await getMemoryQueue().getJobs([
      'delayed',
      'paused',
      'prioritized',
      'wait',
      'waiting-children',
    ]);
    let removedJobs = 0;

    for (const job of jobs) {
      const data = job.data as { asyncTaskId?: string };
      if (data.asyncTaskId !== taskId) continue;

      try {
        await job.remove();
        removedJobs += 1;
      } catch {
        // Active or dependency-locked jobs stop at the cooperative cancellation checks.
      }
    }

    return { removedJobs };
  }
}

export const closeMemoryQueueClients = async () => {
  const queue = memoryQueue;
  const flowProducer = memoryFlowProducer;
  memoryQueue = undefined;
  memoryFlowProducer = undefined;

  await Promise.all([queue?.close(), flowProducer?.close()]);
};
