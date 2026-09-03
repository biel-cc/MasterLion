import { describe, expect, it } from 'vitest';

import type { ModelCatalogEntry } from './index';
import {
  filterChatEligibleModels,
  getChatInputModalityConclusion,
  getInputModalityEvidence,
  isChatEligible,
} from './index';

const entry = (over: Partial<ModelCatalogEntry> = {}): ModelCatalogEntry => ({
  abilitySources: { image: 'provider-meta:supported_modalities' },
  contextWindowSource: 'unknown',
  inputModalities: {
    audio: 'unknown',
    file: 'unknown',
    image: 'unknown',
    text: 'supported',
    video: 'unknown',
  },
  kind: 'chat',
  kindSource: 'provider-meta',
  modelId: 'chat-model',
  providerId: 'aihub',
  ...over,
});

describe('model catalog contracts', () => {
  it('admits only catalog entries classified as chat', () => {
    expect(isChatEligible(entry())).toBe(true);
    expect(isChatEligible(entry({ kind: 'unknown' }))).toBe(false);
  });

  it('excludes rerank and embedding ids without an id denylist', () => {
    const models = [
      entry({ kind: 'rerank', modelId: 'qwen3-vl-rerank' }),
      entry({ kind: 'rerank', modelId: 'bge-reranker-v2' }),
      entry({ kind: 'embedding', modelId: 'text-embedding-3-small' }),
      entry({ kind: 'chat', modelId: 'qwen3-vl-plus' }),
    ];
    expect(filterChatEligibleModels(models).map(({ modelId }) => modelId)).toEqual([
      'qwen3-vl-plus',
    ]);
  });

  it('keeps supported image evidence and its field source visible', () => {
    const model = entry({
      inputModalities: { ...entry().inputModalities, image: 'supported' },
      verifiedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(getInputModalityEvidence(model, 'image')).toEqual({
      modality: 'image',
      source: 'provider-meta:supported_modalities',
      state: 'supported',
      verifiedAt: '2026-09-03T00:00:00.000Z',
    });
    expect(getChatInputModalityConclusion(model).kind).toBe('supported');
  });

  it('projects explicit unsupported image evidence as text-only', () => {
    expect(
      getChatInputModalityConclusion(
        entry({ inputModalities: { ...entry().inputModalities, image: 'unsupported' } }),
      ).kind,
    ).toBe('text-only');
  });

  it('never disguises unknown image evidence as unsupported', () => {
    expect(getChatInputModalityConclusion(entry()).kind).toBe('unknown');
  });
});
