import {
  isAiProviderModelChatEligible,
  mergeModelCatalogEntry,
  type PersistedModelCatalog,
} from '@lobechat/business-model-bank';
import { describe, expect, it } from 'vitest';

import { CHAT_FIXTURES, enabledModel, PROVIDER, VERIFIED_AT } from './__tests__/catalogFixtures';
import {
  filterChatEligibleProviderModels,
  getConclusionVerifiedAt,
  parseEvidenceSource,
  resolveChatModelCatalog,
  sortNonTextModalities,
} from './modality';

const withCatalog = (catalog: PersistedModelCatalog) => ({
  id: catalog.entry.modelId,
  providerId: catalog.entry.providerId,
  settings: { modelCatalog: catalog },
});

describe('resolveChatModelCatalog', () => {
  it('reads persisted supported evidence with its field source and verifiedAt', () => {
    const resolved = resolveChatModelCatalog(withCatalog(CHAT_FIXTURES.supported));

    expect(resolved.chatEligible).toBe(true);
    expect(resolved.inputModality.kind).toBe('supported');
    expect(resolved.inputModality).toMatchObject({ modalities: ['image'] });
    expect(resolved.inputModality.evidence.image).toEqual({
      modality: 'image',
      source: 'provider-meta',
      state: 'supported',
      verifiedAt: VERIFIED_AT,
    });
    expect(getConclusionVerifiedAt(resolved.inputModality)).toBe(VERIFIED_AT);
  });

  it('projects four explicit rejections as text-only', () => {
    const resolved = resolveChatModelCatalog(withCatalog(CHAT_FIXTURES.textOnly));

    expect(resolved.inputModality.kind).toBe('text-only');
    expect(resolved.entry.inputModalities.text).toBe('supported');
  });

  it('keeps incomplete evidence unknown and never disguises it as text-only', () => {
    const resolved = resolveChatModelCatalog(withCatalog(CHAT_FIXTURES.unknown));

    expect(resolved.inputModality.kind).toBe('unknown');
    expect(resolved.inputModality).toMatchObject({
      modalities: expect.arrayContaining(['audio', 'file', 'image', 'video']),
    });
    expect(getConclusionVerifiedAt(resolved.inputModality)).toBeUndefined();
  });

  it('falls back to legacy abilities only as catalog-level modality evidence', () => {
    const vision = resolveChatModelCatalog({
      abilities: { vision: true },
      id: 'custom-chat',
      providerId: PROVIDER,
    });
    expect(vision.chatEligible).toBe(true);
    expect(vision.inputModality.kind).toBe('supported');
    expect(vision.inputModality.evidence.image.source).toBe('catalog');

    // audio has no ability boolean, so three explicit false values are still not text-only
    const noVision = resolveChatModelCatalog({
      abilities: { files: false, video: false, vision: false },
      id: 'custom-chat',
      providerId: PROVIDER,
    });
    expect(noVision.inputModality.kind).toBe('unknown');
    expect(noVision.inputModality.evidence.image.state).toBe('unsupported');
    expect(noVision.inputModality.evidence.audio.state).toBe('unknown');
  });

  it('ignores persisted evidence that belongs to a different provider or model', () => {
    const resolved = resolveChatModelCatalog({
      ...withCatalog(CHAT_FIXTURES.supported),
      providerId: 'other-provider',
    });

    expect(resolved.inputModality.kind).toBe('unknown');
  });

  it('mirrors B1 chat eligibility for rerank and embedding ids without a denylist', () => {
    for (const id of [
      'qwen3-vl-rerank',
      'bge-reranker-v2',
      'text-embedding-3-small',
      'qwen3-vl-plus',
    ]) {
      const model = { id, providerId: PROVIDER, type: 'chat' as const };

      expect(resolveChatModelCatalog(model).chatEligible).toBe(
        isAiProviderModelChatEligible(model),
      );
    }

    expect(
      resolveChatModelCatalog({ id: 'qwen3-vl-rerank', providerId: PROVIDER }).chatEligible,
    ).toBe(false);
    expect(
      resolveChatModelCatalog({ id: 'text-embedding-3-small', providerId: PROVIDER }).chatEligible,
    ).toBe(false);
    expect(
      resolveChatModelCatalog({ id: 'qwen3-vl-plus', providerId: PROVIDER }).chatEligible,
    ).toBe(true);
  });

  it('honours persisted manual allow/deny instead of the model id', () => {
    const allowed = resolveChatModelCatalog(
      withCatalog(
        mergeModelCatalogEntry({
          manual: {
            allowChat: true,
            createdAt: '2026-09-01T00:00:00.000Z',
            owner: 'ops',
            reason: 'verified chat endpoint',
          },
          modelId: 'legacy-rerank-chat',
          providerId: PROVIDER,
        }),
      ),
    );
    expect(allowed.chatEligible).toBe(true);

    const denied = resolveChatModelCatalog(
      withCatalog(
        mergeModelCatalogEntry({
          manual: {
            createdAt: '2026-09-01T00:00:00.000Z',
            denyChat: true,
            owner: 'ops',
            reason: 'broken',
          },
          modelId: 'qwen3-vl-plus',
          providerId: PROVIDER,
        }),
      ),
    );
    expect(denied.entry.kind).toBe('chat');
    expect(denied.chatEligible).toBe(false);
  });
});

describe('filterChatEligibleProviderModels', () => {
  const providers = [
    {
      children: [
        { abilities: {}, id: 'qwen3-vl-rerank' },
        { abilities: {}, id: 'text-embedding-3-small' },
        { abilities: { vision: true }, id: 'qwen3-vl-plus' },
      ],
      id: PROVIDER,
      name: 'Aihub',
    },
    { children: [], id: 'empty', name: 'Empty' },
  ];

  it('drops rerank and embedding rows and keeps providers with no rows', () => {
    const result = filterChatEligibleProviderModels(providers);

    expect(result.map((p) => p.children.map((m) => m.id))).toEqual([['qwen3-vl-plus'], []]);
  });

  it('prefers store evidence over the bare row when both are present', () => {
    const result = filterChatEligibleProviderModels(providers, [
      enabledModel(
        mergeModelCatalogEntry({
          modelId: 'qwen3-vl-plus',
          providerId: PROVIDER,
          providerMetadata: { declaredKind: 'rerank' },
        }),
      ),
    ]);

    // the store classifies this exact provider/model pair as rerank, so the row is gone
    expect(result[0].children).toEqual([]);
  });
});

describe('evidence helpers', () => {
  it('parses B1 ability sources', () => {
    expect(parseEvidenceSource(undefined)).toEqual({ kind: 'unknown' });
    expect(parseEvidenceSource('unknown')).toEqual({ kind: 'unknown' });
    expect(parseEvidenceSource('provider-meta')).toEqual({ kind: 'provider-meta' });
    expect(parseEvidenceSource('manual:ops')).toEqual({ detail: 'ops', kind: 'manual' });
    expect(parseEvidenceSource('default:chat-kind')).toEqual({
      detail: 'chat-kind',
      kind: 'default',
    });
    expect(parseEvidenceSource('mystery')).toEqual({ detail: 'mystery', kind: 'unknown' });
  });

  it('orders modalities image, audio, video, file', () => {
    expect(sortNonTextModalities(['file', 'video', 'audio', 'image'])).toEqual([
      'image',
      'audio',
      'video',
      'file',
    ]);
  });
});
