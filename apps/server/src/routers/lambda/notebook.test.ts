// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';

import { notebookRouter } from './notebook';

const {
  findByTopicId,
  findLatestPlanByTopicId,
  findPlanMetadataByTopicId,
  findSummariesByTopicId,
  getServerDB,
} = vi.hoisted(() => ({
  findByTopicId: vi.fn(),
  findLatestPlanByTopicId: vi.fn(),
  findPlanMetadataByTopicId: vi.fn(),
  findSummariesByTopicId: vi.fn(),
  getServerDB: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB }));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({ findById: vi.fn() })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => ({
    findByTopicId,
    findLatestPlanByTopicId,
    findPlanMetadataByTopicId,
    findSummariesByTopicId,
  })),
}));

vi.mock('@/server/services/notebook', () => ({
  NotebookRuntimeService: vi.fn(() => ({})),
}));

const createCaller = createCallerFactory(notebookRouter);
const associatedAt = new Date('2026-08-27T01:00:00.000Z');
const createdAt = new Date('2026-08-27T00:00:00.000Z');
const updatedAt = new Date('2026-08-27T02:00:00.000Z');

const summary = {
  associatedAt,
  createdAt,
  description: 'Short description',
  fileType: 'markdown',
  filename: 'report.md',
  id: 'doc-summary',
  title: 'Report',
  totalCharCount: 1_000_000,
  totalLineCount: 100,
  updatedAt,
};

const fullPlan = {
  ...summary,
  content: '# Full plan',
  editorData: { root: {} },
  fileType: 'agent/plan',
  metadata: { todos: { items: [{ completed: false, text: 'Ship fix' }] } },
  pages: [{ pageContent: 'full page' }],
};

describe('notebookRouter document reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSummariesByTopicId.mockResolvedValue([summary]);
    findByTopicId.mockResolvedValue([fullPlan]);
    findLatestPlanByTopicId.mockResolvedValue(fullPlan);
    findPlanMetadataByTopicId.mockResolvedValue([
      { id: 'doc-plan', metadata: fullPlan.metadata },
    ]);
  });

  const caller = async () => createCaller(await createContextInner({ userId: 'user-1' }));

  it('returns a bounded summary contract for the canonical list interface', async () => {
    const result = await (await caller()).listDocumentSummaries({ topicId: 'topic-1' });

    expect(result).toEqual({ data: [summary], total: 1 });
    expect(findSummariesByTopicId).toHaveBeenCalledWith('topic-1');
    expect(findByTopicId).not.toHaveBeenCalled();
    expect(result.data[0]).not.toHaveProperty('content');
    expect(result.data[0]).not.toHaveProperty('metadata');
  });

  it('slims legacy unfiltered lists so old Electron clients stop loading full rows', async () => {
    const result = await (await caller()).listDocuments({ topicId: 'topic-1' });

    expect(findSummariesByTopicId).toHaveBeenCalledWith('topic-1', { type: undefined });
    expect(findByTopicId).not.toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({ content: null, id: 'doc-summary', metadata: null });
    expect(findPlanMetadataByTopicId).toHaveBeenCalledWith('topic-1');
  });

  it('preserves plan metadata for pre-summary Electron clients', async () => {
    findSummariesByTopicId.mockResolvedValue([
      summary,
      { ...summary, fileType: 'agent/plan', id: 'doc-plan', title: 'Plan' },
    ]);

    const result = await (await caller()).listDocuments({ topicId: 'topic-1' });

    expect(result.data).toEqual([
      expect.objectContaining({ id: 'doc-summary', metadata: null }),
      expect.objectContaining({ content: null, id: 'doc-plan', metadata: fullPlan.metadata }),
    ]);
    expect(findByTopicId).not.toHaveBeenCalled();
  });

  it('keeps the legacy agent plan list full for older clients', async () => {
    const result = await (await caller()).listDocuments({
      topicId: 'topic-1',
      type: 'agent/plan',
    });

    expect(findByTopicId).toHaveBeenCalledWith('topic-1', { type: 'agent/plan' });
    expect(findSummariesByTopicId).not.toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({ content: '# Full plan', metadata: fullPlan.metadata });
  });

  it('returns one full latest plan through the dedicated plan interface', async () => {
    const result = await (await caller()).getLatestPlan({ topicId: 'topic-1' });

    expect(findLatestPlanByTopicId).toHaveBeenCalledWith('topic-1');
    expect(result).toMatchObject({ content: '# Full plan', id: 'doc-summary' });
  });

  it('normalizes transient database failures without exposing the SQL error', async () => {
    findSummariesByTopicId.mockRejectedValue(
      Object.assign(new Error('select content from documents where user_id = secret'), {
        code: '57P03',
      }),
    );

    await expect(
      (await caller()).listDocumentSummaries({ topicId: 'topic-1' }),
    ).rejects.toMatchObject({
      cause: { data: { reason: 'DATABASE_RECOVERING' } },
      code: 'SERVICE_UNAVAILABLE',
      message: 'Notebook documents are temporarily unavailable',
    });
  });
});
