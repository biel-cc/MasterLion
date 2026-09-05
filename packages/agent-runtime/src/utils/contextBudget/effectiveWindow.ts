import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';

import { type EffectiveContextWindow, WINDOW_UNKNOWN_WARNING } from './types';

export const ASSUMED_CONTEXT_WINDOW_TOKENS = 32_000;

const positiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
};

export interface ResolveEffectiveContextWindowInput {
  catalogSnapshot?: ModelCatalogSnapshot;
  configuredWindowTokens?: number;
  modelId: string;
  observedWindowTokens?: number;
  providerId: string;
}

/** Resolve the frozen effective window. Provider-observed limits always take precedence. */
export const resolveEffectiveContextWindow = ({
  catalogSnapshot,
  configuredWindowTokens,
  modelId,
  observedWindowTokens,
  providerId,
}: ResolveEffectiveContextWindowInput): EffectiveContextWindow => {
  const observed = positiveInteger(observedWindowTokens);
  if (observed) return { source: 'observed', warnings: [], windowTokens: observed };

  const entry = catalogSnapshot?.entry;
  const snapshotMatches = entry?.modelId === modelId && entry.providerId === providerId;
  const catalogTokens = snapshotMatches ? positiveInteger(entry.contextWindowTokens) : undefined;
  const configured = positiveInteger(configuredWindowTokens);
  if (catalogTokens && entry && entry.contextWindowSource !== 'unknown') {
    if (configured && configured < catalogTokens) {
      return { source: 'manual', warnings: [], windowTokens: configured };
    }

    return {
      source: entry.contextWindowSource,
      warnings: [],
      windowTokens: catalogTokens,
    };
  }

  if (configured) return { source: 'manual', warnings: [], windowTokens: configured };

  return {
    source: 'assumed',
    warnings: [WINDOW_UNKNOWN_WARNING],
    windowTokens: ASSUMED_CONTEXT_WINDOW_TOKENS,
  };
};
