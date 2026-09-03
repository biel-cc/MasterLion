import { describe, expect, it } from 'vitest';

import { decideContextBudget, type ContextBudgetDecision } from '@lobechat/types/src/contextBudget';
import type { ExecutionContext, ExecutionEnvAdapter } from '@lobechat/types/src/executionContext';
import {
  getChatInputModalityConclusion,
  type ModelCatalogEntry,
} from '@lobechat/types/src/modelCatalog';
import type {
  SkillProvider,
  TopicExecutionSnapshot,
  TopicPlacement,
} from '@lobechat/types/src/projectWorkspace';

describe('workspace runtime package subpath contracts', () => {
  it('supports representative A-F compile and runtime consumers without the root barrel', async () => {
    const topicSnapshot: TopicExecutionSnapshot = {
      target: 'none',
      targetCapturedAt: '2026-09-03T00:00:00.000Z',
      version: 1,
    };
    const executionContext: ExecutionContext = {
      plan: { kind: 'none', target: topicSnapshot.target },
      snapshot: topicSnapshot,
      unresolvedReason: 'target-none',
      version: 1,
    };
    const placement: TopicPlacement = { kind: 'recent', reason: 'unbound' };
    const envAdapter: ExecutionEnvAdapter = {
      resolve: async () => ({ secretKeys: [], sources: {}, values: {} }),
      summarize: (env) => ({ keys: Object.keys(env.values), secretKeys: env.secretKeys }),
    };
    const skillProvider: SkillProvider = { list: async () => [], source: 'builtin' };
    const model: ModelCatalogEntry = {
      abilitySources: {},
      contextWindowSource: 'unknown',
      inputModalities: {
        audio: 'unsupported',
        file: 'unsupported',
        image: 'unsupported',
        text: 'supported',
        video: 'unsupported',
      },
      kind: 'chat',
      kindSource: 'default',
      modelId: 'chat-model',
      providerId: 'aihub',
    };
    const budgetDecision: ContextBudgetDecision = decideContextBudget({
      budgetTokens: 28_000,
      candidateIds: [],
      compressionAttempt: 0,
      offending: [],
      payloadFingerprint: 'payload',
      preservedIds: [],
      promptTokens: 1_000,
      source: 'unknown/assumed',
      tailTokens: 1_000,
      trigger: 'final-preflight',
      windowTokens: 32_000,
    });

    expect(executionContext.unresolvedReason).toBe('target-none');
    expect(placement.kind).toBe('recent');
    expect(
      (await envAdapter.resolve({ agentId: 'a', operationId: 'o', userId: 'u' })).values,
    ).toEqual({});
    expect(
      await skillProvider.list({
        agentId: 'a',
        skillPolicy: {
          includeAgentSkills: true,
          includeProjectSkills: true,
          includeUserSkills: true,
        },
        userId: 'u',
      }),
    ).toEqual([]);
    expect(getChatInputModalityConclusion(model).kind).toBe('text-only');
    expect(budgetDecision.kind).toBe('send');
  });
});
