import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemorySourceType } from '@/types/userMemory';

import { closeMemoryQueueClients, MemoryExtractionQueueService } from './service';

const {
  mockAdd,
  mockFlowAdd,
  mockGetJobs,
  mockQueueClose,
  mockRemove,
  mockRemoveJobScheduler,
  mockUpsertJobScheduler,
} = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockFlowAdd: vi.fn(),
  mockGetJobs: vi.fn(),
  mockQueueClose: vi.fn(),
  mockRemove: vi.fn(),
  mockRemoveJobScheduler: vi.fn(),
  mockUpsertJobScheduler: vi.fn(),
}));

vi.mock('ioredis', () => ({
  default: vi.fn(() => ({})),
}));

vi.mock('bullmq', () => ({
  FlowProducer: vi.fn(() => ({
    add: mockFlowAdd,
    close: mockQueueClose,
  })),
  Queue: vi.fn(() => ({
    add: mockAdd,
    close: mockQueueClose,
    getJobs: mockGetJobs,
    removeJobScheduler: mockRemoveJobScheduler,
    upsertJobScheduler: mockUpsertJobScheduler,
  })),
}));

describe('MemoryExtractionQueueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    process.env.REDIS_PREFIX = 'test';
    delete process.env.MEMORY_QUEUE_REDIS_URL;
    mockAdd.mockImplementation(async (_name, _data, options) => ({ id: options.jobId }));
    mockFlowAdd.mockResolvedValue({
      children: [{ job: { id: 'topic-job' } }],
      job: { id: 'persona-job' },
    });
    mockGetJobs.mockResolvedValue([]);
    mockRemoveJobScheduler.mockResolvedValue(true);
    mockUpsertJobScheduler.mockResolvedValue({ id: 'scheduler-job' });
  });

  afterEach(async () => {
    await closeMemoryQueueClients();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_PREFIX;
    delete process.env.MEMORY_QUEUE_REDIS_URL;
  });

  it('fails closed when Redis is not configured', async () => {
    delete process.env.REDIS_URL;

    await expect(
      MemoryExtractionQueueService.triggerProcessUsers({ userIds: ['user-1'] }),
    ).rejects.toThrow('REDIS_URL is required');
  });

  it('uses a deterministic job id to deduplicate the same root task', async () => {
    const payload = {
      asyncTaskId: '65e11dc6-0549-4f6f-a126-753baf576ef6',
      sources: [MemorySourceType.ChatTopic],
      userIds: ['user-1'],
    };

    const first = await MemoryExtractionQueueService.triggerProcessUsers(payload);
    const second = await MemoryExtractionQueueService.triggerProcessUsers(payload);

    expect(first.jobId).toBe(second.jobId);
    expect(first.jobId).not.toContain(':');
    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(mockAdd.mock.calls[0][2].jobId).toBe(mockAdd.mock.calls[1][2].jobId);
  });

  it('creates isolated topic jobs and a persona parent that tolerates topic failures', async () => {
    await MemoryExtractionQueueService.triggerTopicFlow('user-1', {
      asyncTaskId: '65e11dc6-0549-4f6f-a126-753baf576ef6',
      sources: [MemorySourceType.ChatTopic],
      topicIds: ['topic-1', 'topic-2'],
      userIds: ['user-1'],
    });

    const flow = mockFlowAdd.mock.calls[0][0];
    expect(flow.name).toBe('persona-update');
    expect(flow.children).toHaveLength(2);
    expect(flow.children[0]).toMatchObject({
      name: 'process-topic',
      opts: {
        attempts: 1,
        ignoreDependencyOnFailure: true,
      },
      queueName: 'memory-user-memory',
    });
  });

  it('registers the internal hourly scheduler idempotently', async () => {
    await MemoryExtractionQueueService.ensureHourlyScheduler();

    expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
      'memory-user-memory-hourly',
      { pattern: '0 * * * *' },
      expect.objectContaining({ name: 'hourly' }),
    );
  });

  it('removes the hourly scheduler when scheduled extraction is disabled', async () => {
    await MemoryExtractionQueueService.disableHourlyScheduler();

    expect(mockRemoveJobScheduler).toHaveBeenCalledWith('memory-user-memory-hourly');
  });

  it('removes queued jobs for a cancelled task and leaves unrelated jobs alone', async () => {
    mockGetJobs.mockResolvedValue([
      { data: { asyncTaskId: 'task-1' }, remove: mockRemove },
      { data: { asyncTaskId: 'task-2' }, remove: vi.fn() },
    ]);

    await expect(MemoryExtractionQueueService.cancelTask('task-1')).resolves.toEqual({
      removedJobs: 1,
    });
    expect(mockRemove).toHaveBeenCalledOnce();
  });
});
