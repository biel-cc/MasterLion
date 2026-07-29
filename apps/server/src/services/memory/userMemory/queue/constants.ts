export const MEMORY_QUEUE_NAME = 'memory-user-memory';

export const MEMORY_QUEUE_JOB_NAMES = {
  hourly: 'hourly',
  personaUpdate: 'persona-update',
  processTopic: 'process-topic',
  processTopics: 'process-topics',
  processUsers: 'process-users',
  processUserTopics: 'process-user-topics',
} as const;

export type MemoryQueueJobName =
  (typeof MEMORY_QUEUE_JOB_NAMES)[keyof typeof MEMORY_QUEUE_JOB_NAMES];

export const MEMORY_QUEUE_HOURLY_SCHEDULER_ID = 'memory-user-memory-hourly';

export const MEMORY_QUEUE_DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    delay: 5000,
    type: 'exponential',
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 1000,
  },
} as const;
