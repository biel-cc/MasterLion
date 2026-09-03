import { getChatInputModalityConclusion } from '@lobechat/types/src/modelCatalog';
import { describe, expect, it } from 'vitest';

import {
  createModelCatalogSnapshot,
  filterAiProviderChatEligibleModels,
  isAiProviderModelChatEligible,
  mergeModelCatalogEntry,
} from './modelCatalog';

const fixtureIds = ['qwen3-vl-rerank', 'bge-reranker-v2', 'text-embedding-3-small'];

describe('model catalog classifier and evidence merge', () => {
  it('classifies the HTTP and bridge paths identically and excludes non-chat defaults', () => {
    const endpointById: Record<string, string[]> = {
      'bge-reranker-v2': ['rerank'],
      'qwen3-vl-rerank': ['rerank'],
      'text-embedding-3-small': ['embeddings'],
    };
    const fromBridge = fixtureIds.map((modelId) =>
      mergeModelCatalogEntry({ modelId, providerId: 'newapi' }),
    );
    const fromHttp = fixtureIds.map((modelId) =>
      mergeModelCatalogEntry({
        modelId,
        providerId: 'newapi',
        providerMetadata: { endpointTypes: endpointById[modelId] },
      }),
    );

    expect(fromBridge.map(({ entry }) => entry.kind)).toEqual(
      fromHttp.map(({ entry }) => entry.kind),
    );
    expect(fromHttp.map(({ entry }) => entry.kind)).toEqual(['rerank', 'rerank', 'embedding']);
    expect(
      fromBridge.every(
        (catalog) =>
          !isAiProviderModelChatEligible({
            id: catalog.entry.modelId,
            providerId: catalog.entry.providerId,
            settings: { modelCatalog: catalog },
          }),
      ),
    ).toBe(true);
    expect(
      filterAiProviderChatEligibleModels(
        fromHttp.map((catalog) => ({
          id: catalog.entry.modelId,
          providerId: catalog.entry.providerId,
          settings: { modelCatalog: catalog },
        })),
      ),
    ).toEqual([]);
  });

  it('retains an ordinary model with an explicit chat endpoint', () => {
    const catalog = mergeModelCatalogEntry({
      modelId: 'company-model-v2',
      providerId: 'newapi',
      providerMetadata: { endpointTypes: ['openai-chat-completions'] },
    });

    expect(catalog.entry).toMatchObject({ kind: 'chat', kindSource: 'provider-meta' });
    expect(
      isAiProviderModelChatEligible({
        id: 'company-model-v2',
        providerId: 'newapi',
        settings: { modelCatalog: catalog },
      }),
    ).toBe(true);
  });

  it('keeps the compatible chat fallback and ignores a stale chat label on rerank ids', () => {
    expect(
      isAiProviderModelChatEligible({
        id: 'company-unknown-v2',
        providerId: 'newapi',
        type: 'chat',
      }),
    ).toBe(true);

    const staleCatalog = mergeModelCatalogEntry({
      catalog: { kind: 'chat' },
      modelId: 'qwen3-vl-rerank',
      providerId: 'newapi',
    });
    expect(staleCatalog.entry).toMatchObject({ kind: 'chat', kindSource: 'catalog' });
    expect(
      isAiProviderModelChatEligible({
        id: 'qwen3-vl-rerank',
        providerId: 'newapi',
        settings: { modelCatalog: staleCatalog },
        type: 'chat',
      }),
    ).toBe(false);
  });

  it('does not infer multimodal support from a vl-shaped name', () => {
    const catalog = mergeModelCatalogEntry({ modelId: 'company-vl-chat', providerId: 'newapi' });

    expect(catalog.entry).toMatchObject({ kind: 'chat', kindSource: 'default' });
    expect(catalog.entry.inputModalities.image).toBe('unknown');
    expect(getChatInputModalityConclusion(catalog.entry).kind).toBe('unknown');
  });

  it('reports supported for any evidenced non-text modality', () => {
    const catalog = mergeModelCatalogEntry({
      modelId: 'mixed-input-chat',
      providerId: 'newapi',
      providerMetadata: {
        inputModalities: {
          audio: 'unsupported',
          file: 'unsupported',
          image: 'unsupported',
          video: 'supported',
        },
      },
    });

    expect(getChatInputModalityConclusion(catalog.entry)).toMatchObject({
      kind: 'supported',
      modalities: ['video'],
    });
    expect(catalog.entry.abilitySources.video).toBe('provider-meta');
  });

  it('distinguishes all explicit unsupported evidence from missing evidence', () => {
    const textOnly = mergeModelCatalogEntry({
      modelId: 'text-chat',
      providerId: 'newapi',
      providerMetadata: {
        inputModalities: {
          audio: 'unsupported',
          file: 'unsupported',
          image: 'unsupported',
          video: 'unsupported',
        },
      },
    });
    const unknown = mergeModelCatalogEntry({ modelId: 'unknown-chat', providerId: 'newapi' });

    expect(getChatInputModalityConclusion(textOnly.entry).kind).toBe('text-only');
    expect(getChatInputModalityConclusion(unknown.entry).kind).toBe('unknown');
  });

  it('lets manual evidence override only named fields and records conflicting drift', () => {
    const catalog = mergeModelCatalogEntry({
      catalog: {
        abilities: { files: true, vision: true },
        contextWindowTokens: 128_000,
        kind: 'chat',
      },
      manual: {
        createdAt: '2026-09-01T00:00:00.000Z',
        inputModalities: { image: 'unsupported' },
        owner: 'model-ops',
        reason: 'provider rejects image payloads',
      },
      modelId: 'catalog-chat',
      now: '2026-09-03T00:00:00.000Z',
      providerId: 'newapi',
    });

    expect(catalog.entry.inputModalities).toMatchObject({
      file: 'supported',
      image: 'unsupported',
    });
    expect(catalog.drift).toContainEqual(
      expect.objectContaining({
        conflictingSource: 'catalog',
        field: 'inputModalities.image',
        selectedSource: 'manual:model-ops',
      }),
    );
  });

  it('preserves observed/manual subdocuments and applies manual deny on the next merge', () => {
    const manual = {
      createdAt: '2026-09-01T00:00:00.000Z',
      denyChat: true,
      owner: 'model-ops',
      reason: 'incident response',
    } as const;
    const observed = {
      contextWindowRejectionTokens: 32_000,
      inputModalities: { image: 'unsupported' as const },
      verifiedAt: '2026-09-02T00:00:00.000Z',
    };
    const refreshed = mergeModelCatalogEntry({
      catalog: { contextWindowTokens: 128_000, kind: 'chat' },
      manual,
      modelId: 'observed-chat',
      now: '2026-09-03T00:00:00.000Z',
      observed,
      providerId: 'newapi',
    });

    expect(refreshed).toMatchObject({ denied: true, manual, observed });
    expect(refreshed.entry).toMatchObject({
      contextWindowSource: 'observed',
      contextWindowTokens: 32_000,
    });
    expect(
      isAiProviderModelChatEligible({
        id: 'observed-chat',
        providerId: 'newapi',
        settings: { modelCatalog: refreshed },
      }),
    ).toBe(false);
  });

  it('serializes the same catalog entry into an operation snapshot without sharing maps', () => {
    const catalog = mergeModelCatalogEntry({ modelId: 'chat-model', providerId: 'newapi' });
    const snapshot = createModelCatalogSnapshot(
      catalog.entry,
      'operation-1',
      '2026-09-03T00:00:00.000Z',
    );

    expect(snapshot).toMatchObject({
      capturedAt: '2026-09-03T00:00:00.000Z',
      entry: catalog.entry,
      operationId: 'operation-1',
      version: 1,
    });
    expect(snapshot.entry.inputModalities).not.toBe(catalog.entry.inputModalities);
  });
});
