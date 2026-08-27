import { describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { createServerPlanRuntimeService } from '../lobeAgentPlan';

const { findLatestPlanByTopicId } = vi.hoisted(() => ({
  findLatestPlanByTopicId: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => ({
    findLatestPlanByTopicId,
  })),
}));

describe('createServerPlanRuntimeService', () => {
  it('scopes document models to workspace context', () => {
    const serverDB = {} as never;

    createServerPlanRuntimeService(serverDB, 'user-1', 'workspace-1');

    expect(DocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
    expect(TopicDocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
  });

  it('loads one full latest plan through the dedicated plan query', async () => {
    const plan = {
      content: '# Full plan',
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
      description: 'Plan description',
      id: 'plan-1',
      metadata: { todos: { items: [] } },
      title: 'Plan',
      updatedAt: new Date('2026-08-27T01:00:00.000Z'),
    };
    findLatestPlanByTopicId.mockResolvedValue(plan);
    const runtime = createServerPlanRuntimeService({} as never, 'user-1');

    await expect(runtime.findPlanByTopic('topic-1')).resolves.toEqual(plan);
    expect(findLatestPlanByTopicId).toHaveBeenCalledWith('topic-1');
  });
});
