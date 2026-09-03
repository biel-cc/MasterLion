import { mergeModelCatalogEntry, type PersistedModelCatalog } from '@lobechat/business-model-bank';
import type { EnabledAiModel, ModelAbilities } from 'model-bank';

export const PROVIDER = 'newapi';
export const VERIFIED_AT = '2026-09-01T00:00:00.000Z';

/** image supported, the other three explicitly unsupported, provider verified. */
export const supportedCatalog = (modelId = 'qwen3-vl-plus') =>
  mergeModelCatalogEntry({
    modelId,
    providerId: PROVIDER,
    providerMetadata: {
      supportedInputModalities: ['image'],
      unsupportedInputModalities: ['audio', 'video', 'file'],
      verifiedAt: VERIFIED_AT,
    },
  });

/** all four non-text modalities explicitly unsupported. */
export const textOnlyCatalog = (modelId = 'glm-5.1') =>
  mergeModelCatalogEntry({
    modelId,
    providerId: PROVIDER,
    providerMetadata: {
      unsupportedInputModalities: ['image', 'audio', 'video', 'file'],
      verifiedAt: VERIFIED_AT,
    },
  });

/** no modality evidence at all: text is assumed for a chat kind, the rest stay unknown. */
export const unknownCatalog = (modelId = 'deepseek-v4') =>
  mergeModelCatalogEntry({ modelId, providerId: PROVIDER });

/** classified as rerank by B1 without any UI denylist. */
export const rerankCatalog = (modelId = 'qwen3-vl-rerank') =>
  mergeModelCatalogEntry({ modelId, providerId: PROVIDER });

export const enabledModel = (
  catalog: PersistedModelCatalog,
  abilities: ModelAbilities = {},
): EnabledAiModel => ({
  abilities,
  displayName: catalog.entry.modelId,
  id: catalog.entry.modelId,
  providerId: catalog.entry.providerId,
  settings: { modelCatalog: catalog },
  type: 'chat',
});

export const CHAT_FIXTURES = {
  supported: supportedCatalog(),
  textOnly: textOnlyCatalog(),
  unknown: unknownCatalog(),
};
