/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { CHAT_FIXTURES, enabledModel, PROVIDER, rerankCatalog } from './__tests__/catalogFixtures';
import { useChatEligibleModelList, useChatModelCatalog } from './hooks';

const storeState = {
  enabledAiModels: [
    enabledModel(CHAT_FIXTURES.supported),
    enabledModel(CHAT_FIXTURES.textOnly),
    enabledModel(CHAT_FIXTURES.unknown),
    enabledModel(rerankCatalog()),
    // legacy remote row: type says chat, nothing else; B1 reclassifies from the id
    {
      abilities: {},
      id: 'text-embedding-3-small',
      providerId: PROVIDER,
      type: 'chat' as const,
    },
  ],
};

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

const enabledChatModelList: EnabledProviderWithModels[] = [
  {
    children: [
      { abilities: {}, displayName: 'Qwen3 VL Plus', id: 'qwen3-vl-plus' },
      { abilities: {}, displayName: 'GLM-5.1', id: 'glm-5.1' },
      { abilities: {}, displayName: 'DeepSeek V4', id: 'deepseek-v4' },
      { abilities: {}, displayName: 'Qwen3 VL Rerank', id: 'qwen3-vl-rerank' },
      { abilities: {}, displayName: 'Embedding', id: 'text-embedding-3-small' },
    ],
    id: PROVIDER,
    name: 'Aihub',
    source: 'builtin',
  },
];

vi.mock('@/hooks/useEnabledChatModels', () => ({
  useEnabledChatModels: () => enabledChatModelList,
}));

describe('useChatEligibleModelList', () => {
  it('only exposes rows that B1 classifies as chat', () => {
    const { result } = renderHook(() => useChatEligibleModelList());

    expect(result.current.map((p) => p.children.map((m) => m.id))).toEqual([
      ['qwen3-vl-plus', 'glm-5.1', 'deepseek-v4'],
    ]);
  });
});

describe('useChatModelCatalog', () => {
  it('uses the persisted store evidence for the exact provider/model pair', () => {
    const { result } = renderHook(() =>
      useChatModelCatalog({ id: 'qwen3-vl-plus', providerId: PROVIDER }),
    );

    expect(result.current.chatEligible).toBe(true);
    expect(result.current.inputModality.kind).toBe('supported');
    expect(result.current.inputModality.evidence.image.source).toBe('provider-meta');
  });

  it('falls back to row abilities when the store has no matching model', () => {
    const { result } = renderHook(() =>
      useChatModelCatalog({ abilities: { vision: true }, id: 'not-in-store', providerId: 'x' }),
    );

    expect(result.current.inputModality.kind).toBe('supported');
    expect(result.current.inputModality.evidence.image.source).toBe('catalog');
  });

  it('never reports a rerank row as chat eligible', () => {
    const { result } = renderHook(() =>
      useChatModelCatalog({ id: 'qwen3-vl-rerank', providerId: PROVIDER }),
    );

    expect(result.current.chatEligible).toBe(false);
  });
});
