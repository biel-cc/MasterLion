import Redis from 'ioredis';

const resolveRedisUrl = () => process.env.MEMORY_QUEUE_REDIS_URL || process.env.REDIS_URL;

export const requireMemoryQueueRedisUrl = () => {
  const redisUrl = resolveRedisUrl();

  if (!redisUrl) {
    throw new Error('REDIS_URL is required for the internal memory queue');
  }

  return redisUrl;
};

export const getMemoryQueuePrefix = () =>
  `${process.env.REDIS_PREFIX || 'masterlion'}:memory-queue`;

export const createMemoryQueueProducerConnection = () =>
  new Redis(requireMemoryQueueRedisUrl(), {
    connectTimeout: 10_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

export const createMemoryQueueWorkerConnection = () =>
  new Redis(requireMemoryQueueRedisUrl(), {
    connectTimeout: 10_000,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
