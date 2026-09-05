import type { UIChatMessage } from '@lobechat/types';
import type { ContextCompressionOutcome } from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';
import { describe, expect, it, vi } from 'vitest';

import { runContextBudgetedCall } from './flow';
import type { ContextBudgetEvaluation, FinalContextPayload } from './types';

const assistant = (id: string, tokens: number): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id,
    metadata: { usage: { totalOutputTokens: tokens } },
    role: 'assistant',
    updatedAt: 0,
  }) as UIChatMessage;

const user = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 0, id, role: 'user', updatedAt: 0 }) as UIChatMessage;

const snapshot: ModelCatalogSnapshot = {
  capturedAt: '2026-09-03T00:00:00.000Z',
  entry: {
    abilitySources: {},
    contextWindowSource: 'catalog',
    contextWindowTokens: 128_000,
    inputModalities: {
      audio: 'unknown',
      file: 'unknown',
      image: 'unknown',
      text: 'supported',
      video: 'unknown',
    },
    kind: 'chat',
    kindSource: 'catalog',
    modelId: 'model-a',
    providerId: 'provider-a',
  },
  operationId: 'operation-a',
  version: 1,
};

const base = {
  catalogSnapshot: snapshot,
  driftMultiplier: 1,
  modelId: 'model-a',
  operationId: 'operation-a',
  providerId: 'provider-a',
};

const reducedPayload = (payload: FinalContextPayload): FinalContextPayload => ({
  ...payload,
  messages: [
    { ...assistant('summary', 1000), content: 'compressed summary' },
    payload.messages.at(-1) as UIChatMessage,
  ],
});

const compressedOutcome = (
  evaluation: ContextBudgetEvaluation,
  afterTokens = 1001,
): ContextCompressionOutcome => ({
  afterTokens,
  attempt: 1,
  beforeTokens: evaluation.estimatedPromptTokens,
  outcome: 'compressed',
  payloadFingerprint: evaluation.payloadFingerprint,
  trigger:
    evaluation.decision.kind === 'compress' ? evaluation.decision.trigger : 'final-preflight',
});

describe('runContextBudgetedCall', () => {
  it('compresses an oversized final injected payload before the first provider call', async () => {
    const callProvider = vi.fn(async () => 'ok');
    const compress = vi.fn(
      async (payload: FinalContextPayload, evaluation: ContextBudgetEvaluation) => {
        expect(callProvider).not.toHaveBeenCalled();
        return { outcome: compressedOutcome(evaluation), payload: reducedPayload(payload) };
      },
    );

    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress,
      payload: { messages: [assistant('old', 40_000), user('latest', 'go')] },
      configuredWindowTokens: 32_000,
    });

    expect(result.kind).toBe('success');
    expect(compress).toHaveBeenCalledTimes(1);
    expect(callProvider).toHaveBeenCalledTimes(1);
  });

  it('uses an observed 32k provider limit, retries once, then returns RETRY_EXHAUSTED', async () => {
    const callProvider = vi.fn(async () => {
      throw {
        code: 'ExceededContextWindow',
        contextWindowTokens: 32_000,
      };
    });
    const compress = vi.fn(
      async (payload: FinalContextPayload, evaluation: ContextBudgetEvaluation) => ({
        outcome: compressedOutcome(evaluation),
        payload: reducedPayload(payload),
      }),
    );
    const onContextWindowObserved = vi.fn();

    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress,
      onContextWindowObserved,
      payload: { messages: [assistant('old', 20_000), user('latest', 'go')] },
    });

    expect(result).toMatchObject({ decision: { code: 'RETRY_EXHAUSTED' }, kind: 'fail' });
    expect(callProvider).toHaveBeenCalledTimes(2);
    expect(compress).toHaveBeenCalledTimes(1);
    expect(result.evaluations.some((item) => item.window.source === 'observed')).toBe(true);
    expect(onContextWindowObserved).toHaveBeenCalledTimes(2);
    expect(onContextWindowObserved).toHaveBeenNthCalledWith(1, {
      contextWindowRejectionTokens: 32_000,
      modelId: 'model-a',
      modelVersion: undefined,
      providerId: 'provider-a',
    });
  });

  it('discards each failed provider attempt before retrying or returning exhausted', async () => {
    const lifecycle: string[] = [];
    const callProvider = vi.fn(async () => {
      lifecycle.push(`provider:${callProvider.mock.calls.length}`);
      throw { code: 'ExceededContextWindow', contextWindowTokens: 32_000 };
    });
    const onProviderAttemptDiscard = vi.fn(
      ({ attempt, willRetry }: { attempt: 1 | 2; willRetry: boolean }) => {
        lifecycle.push(`discard:${attempt}:${willRetry}`);
      },
    );

    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress: async (payload, evaluation) => {
        lifecycle.push('compress');
        return { outcome: compressedOutcome(evaluation), payload: reducedPayload(payload) };
      },
      onProviderAttemptDiscard,
      payload: { messages: [assistant('old', 20_000), user('latest', 'go')] },
    });

    expect(result).toMatchObject({ decision: { code: 'RETRY_EXHAUSTED' }, kind: 'fail' });
    expect(lifecycle).toEqual([
      'provider:1',
      'discard:1:true',
      'compress',
      'provider:2',
      'discard:2:false',
    ]);
  });

  it('does not call the provider for a 200k non-compressible attachment tail', async () => {
    const callProvider = vi.fn(async () => 'never');
    const compress = vi.fn();
    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress,
      payload: {
        messages: [assistant('old', 1000), user('latest', 'inspect')],
        providerMedia: [{ estimatedTokens: 200_000, id: 'huge', messageId: 'latest' }],
      },
    });

    expect(result).toMatchObject({ decision: { code: 'TAIL_TOO_LARGE' }, kind: 'fail' });
    expect(compress).not.toHaveBeenCalled();
    expect(callProvider).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'skipped',
      outcome: (evaluation: ContextBudgetEvaluation): ContextCompressionOutcome => ({
        afterTokens: evaluation.estimatedPromptTokens,
        attempt: 1,
        beforeTokens: evaluation.estimatedPromptTokens,
        code: 'NO_CANDIDATES',
        outcome: 'skipped',
        payloadFingerprint: evaluation.payloadFingerprint,
        trigger: 'final-preflight',
      }),
    },
    {
      label: 'failed',
      outcome: (evaluation: ContextBudgetEvaluation): ContextCompressionOutcome => ({
        afterTokens: evaluation.estimatedPromptTokens,
        attempt: 1,
        beforeTokens: evaluation.estimatedPromptTokens,
        code: 'SUMMARY_FAILED',
        outcome: 'failed',
        payloadFingerprint: evaluation.payloadFingerprint,
        trigger: 'final-preflight',
      }),
    },
    {
      label: 'not reduced',
      outcome: (evaluation: ContextBudgetEvaluation): ContextCompressionOutcome => ({
        afterTokens: evaluation.estimatedPromptTokens,
        attempt: 1,
        beforeTokens: evaluation.estimatedPromptTokens,
        outcome: 'compressed',
        payloadFingerprint: evaluation.payloadFingerprint,
        trigger: 'final-preflight',
      }),
    },
  ])('adds no provider call when compression is $label', async ({ outcome }) => {
    const payload = { messages: [assistant('old', 40_000), user('latest', 'go')] };
    const callProvider = vi.fn(async () => 'never');
    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress: async (_payload, evaluation) => ({ outcome: outcome(evaluation), payload }),
      configuredWindowTokens: 32_000,
      payload,
    });

    expect(result.kind).toBe('fail');
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('adds no provider call when compression returns the identical payload fingerprint', async () => {
    const payload = { messages: [assistant('old', 40_000), user('latest', 'go')] };
    const callProvider = vi.fn(async () => 'never');
    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress: async (_payload, evaluation) => ({
        outcome: compressedOutcome(evaluation, 1000),
        payload,
      }),
      configuredWindowTokens: 32_000,
      payload,
    });

    expect(result).toMatchObject({ decision: { code: 'RETRY_EXHAUSTED' }, kind: 'fail' });
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('converts a thrown summary request into SUMMARY_FAILED without mutating originals', async () => {
    const payload = { messages: [assistant('old', 40_000), user('latest', 'go')] };
    const originalMessages = payload.messages;
    const callProvider = vi.fn(async () => 'never');
    const result = await runContextBudgetedCall({
      ...base,
      callProvider,
      compress: async () => {
        throw new Error('summary failed');
      },
      configuredWindowTokens: 32_000,
      payload,
    });

    expect(result).toMatchObject({ decision: { code: 'SUMMARY_FAILED' }, kind: 'fail' });
    expect(payload.messages).toBe(originalMessages);
    expect(callProvider).not.toHaveBeenCalled();
  });
});
