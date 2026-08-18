// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { runHeartbeatTick } from './heartbeatTick';
import { TaskRunnerService } from './index';

const mockSelectTask = vi.fn();

vi.mock('@/database/server', () => ({
  getServerDB: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => mockSelectTask() }),
      }),
    }),
  }),
}));

vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/server/services/taskScheduler', () => ({
  setTaskSchedulerExecutionCallback: vi.fn(),
}));
vi.mock('./index', () => ({ TaskRunnerService: vi.fn() }));

describe('runHeartbeatTick', () => {
  const mockRunner = { runTask: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    (BriefModel as any).mockImplementation(() => ({
      hasUnresolvedUrgentByTask: vi.fn().mockResolvedValue(false),
    }));
    (TaskRunnerService as any).mockImplementation(() => mockRunner);
  });

  it('does not execute an already queued tick after the task is paused', async () => {
    mockSelectTask.mockResolvedValue([
      {
        automationMode: 'heartbeat',
        heartbeatInterval: 60,
        id: 'task-1',
        identifier: 'T-1',
        status: 'paused',
      },
    ]);

    await expect(runHeartbeatTick('task-1', 'user-1')).resolves.toEqual({
      ran: false,
      reason: 'paused',
    });
    expect(mockRunner.runTask).not.toHaveBeenCalled();
  });
});
