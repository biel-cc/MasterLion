import { describe, expect, it, vi } from 'vitest';

import { compressContextHierarchically } from './chunkedCompression';

interface TestMessage {
  id: string;
  text: string;
}

const measurePayload = (messages: readonly TestMessage[]) => ({
  payloadFingerprint: messages.map(({ id, text }) => `${id}:${text}`).join('|'),
  tokens: messages.reduce((sum, message) => sum + message.text.length, 0),
});

const common = {
  buildRequest: (items: readonly { text: string }[], level: number) =>
    `level:${level}\n${items.map((item) => item.text).join('\n')}`,
  candidateIds: ['old-1', 'old-2'],
  createSummaryMessage: (summary: string, _candidateIds: readonly string[], groupId: string) => ({
    id: groupId,
    text: summary,
  }),
  getMessageId: (message: TestMessage) => message.id,
  groupId: 'compression-1',
  measurePayload,
  measureRequest: (request: string) => request.length,
  messages: [
    { id: 'old-1', text: 'a'.repeat(45) },
    { id: 'old-2', text: 'b'.repeat(45) },
    { id: 'tail', text: 'keep me' },
  ],
  renderMessage: (message: TestMessage) => message.text,
  summaryModelBudgetTokens: 30,
  trigger: 'final-preflight' as const,
};

describe('compressContextHierarchically', () => {
  it('chunks and hierarchically summarizes within the summary model budget', async () => {
    const requestTokens: number[] = [];
    const summarize = vi.fn(async (request: string) => {
      requestTokens.push(request.length);
      return `s${requestTokens.length}`;
    });

    const result = await compressContextHierarchically({ ...common, summarize });

    expect(result.outcome).toMatchObject({ outcome: 'compressed' });
    expect(result.group.status).toBe('completed');
    expect(result.group.levels).toBeGreaterThan(1);
    expect(requestTokens.length).toBeGreaterThan(1);
    expect(requestTokens.every((tokens) => tokens <= common.summaryModelBudgetTokens)).toBe(true);
    expect(result.messages).toEqual([
      { id: 'compression-1', text: expect.any(String) },
      common.messages[2],
    ]);
  });

  it('returns SUMMARY_FAILED and atomically preserves originals when any request throws', async () => {
    const summarize = vi.fn(async () => {
      throw new Error('provider secret must not escape');
    });
    const result = await compressContextHierarchically({ ...common, summarize });

    expect(result.outcome).toMatchObject({ code: 'SUMMARY_FAILED', outcome: 'failed' });
    expect(result.group).toMatchObject({ failureCode: 'SUMMARY_FAILED', status: 'failed' });
    expect(result.messages).toEqual(common.messages);
    expect(result.messages[0]).toBe(common.messages[0]);
    expect(JSON.stringify(result.group)).not.toContain('provider secret');
  });

  it('returns a visible skipped outcome when there are no candidates', async () => {
    const result = await compressContextHierarchically({
      ...common,
      candidateIds: [],
      summarize: vi.fn(),
    });

    expect(result.outcome).toMatchObject({ code: 'NO_CANDIDATES', outcome: 'skipped' });
    expect(result.group.status).toBe('skipped');
  });
});
