export type EvidenceState = 'supported' | 'unknown' | 'unsupported';
export type InputModality = 'audio' | 'file' | 'image' | 'text' | 'video';

export type ModelCatalogKind =
  | 'chat'
  | 'embedding'
  | 'image'
  | 'moderation'
  | 'rerank'
  | 'stt'
  | 'tts'
  | 'unknown';

export type ModelKindSource = 'catalog' | 'default' | 'keyword' | 'manual' | 'provider-meta';
export type ContextWindowSource =
  | 'catalog'
  | 'inferred'
  | 'manual'
  | 'observed'
  | 'provider-meta'
  | 'unknown';

export interface ModelCatalogEntry {
  abilitySources: Partial<Record<InputModality, string>>;
  contextWindowSource: ContextWindowSource;
  contextWindowTokens?: number;
  inputModalities: Record<InputModality, EvidenceState>;
  kind: ModelCatalogKind;
  kindSource: ModelKindSource;
  maxOutput?: number;
  modelId: string;
  providerId: string;
  verifiedAt?: string;
}

/** Operation-frozen model evidence shared by client/server preflight and runtime. */
export interface ModelCatalogSnapshot {
  capturedAt: string;
  entry: ModelCatalogEntry;
  operationId: string;
  version: 1;
}

export interface InputModalityEvidence {
  modality: InputModality;
  source?: string;
  state: EvidenceState;
  verifiedAt?: string;
}

export type ChatInputModalityConclusion =
  | { kind: 'supported'; modality: 'image'; source?: string; verifiedAt?: string }
  | { kind: 'text-only'; modality: 'image'; source?: string; verifiedAt?: string }
  | { kind: 'unknown'; modality: 'image'; source?: string; verifiedAt?: string };

/** Chat selection is strict: unknown/non-chat kinds never enter the chat list or default. */
export const isChatEligible = (entry: Pick<ModelCatalogEntry, 'kind'>): boolean =>
  entry.kind === 'chat';

export const filterChatEligibleModels = <T extends Pick<ModelCatalogEntry, 'kind'>>(
  entries: readonly T[],
): T[] => entries.filter(isChatEligible);

export const getInputModalityEvidence = (
  entry: ModelCatalogEntry,
  modality: InputModality,
): InputModalityEvidence => ({
  modality,
  source: entry.abilitySources[modality],
  state: entry.inputModalities[modality],
  verifiedAt: entry.verifiedAt,
});

/** UI projection that keeps unsupported distinct from unknown. */
export const getChatInputModalityConclusion = (
  entry: ModelCatalogEntry,
): ChatInputModalityConclusion => {
  const evidence = getInputModalityEvidence(entry, 'image');
  const common = {
    modality: 'image' as const,
    source: evidence.source,
    verifiedAt: evidence.verifiedAt,
  };

  switch (evidence.state) {
    case 'supported': {
      return { ...common, kind: 'supported' };
    }
    case 'unsupported': {
      return { ...common, kind: 'text-only' };
    }
    default: {
      return { ...common, kind: 'unknown' };
    }
  }
};
