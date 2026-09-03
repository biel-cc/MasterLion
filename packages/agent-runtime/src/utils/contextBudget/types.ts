import type { UIChatMessage } from '@lobechat/types';
import type {
  CompressionAttempt,
  ContextBudgetAttemptState,
  ContextBudgetDecision,
  ContextBudgetOffendingItem,
  ContextBudgetTrace,
  ContextBudgetTrigger,
} from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';

export const WINDOW_UNKNOWN_WARNING = 'WINDOW_UNKNOWN' as const;

export interface FinalPayloadMediaEstimate {
  estimatedTokens: number;
  id?: string;
  messageId?: string;
}

export interface FinalContextPayload {
  messages: UIChatMessage[];
  providerMedia?: FinalPayloadMediaEstimate[];
  tools?: unknown[];
}

export interface EffectiveContextWindow {
  source: string;
  warnings: Array<typeof WINDOW_UNKNOWN_WARNING>;
  windowTokens: number;
}

export interface ContextMessagePartition {
  candidateIds: string[];
  candidateMessages: UIChatMessage[];
  preservedIds: string[];
  preservedMessages: UIChatMessage[];
}

export interface ContextBudgetTraceRecord extends ContextBudgetTrace {
  offending: ContextBudgetOffendingItem[];
  warnings: Array<typeof WINDOW_UNKNOWN_WARNING>;
}

export interface EvaluateContextBudgetInput extends FinalContextPayload {
  attemptState?: Partial<ContextBudgetAttemptState>;
  candidateIds?: readonly string[];
  catalogSnapshot?: ModelCatalogSnapshot;
  configuredWindowTokens?: number;
  driftMultiplier?: number;
  modelId: string;
  observedWindowTokens?: number;
  operationId: string;
  outputReserveTokens?: number;
  preservedIds?: readonly string[];
  providerId: string;
  thresholdRatio?: number;
  trigger: ContextBudgetTrigger;
}

export interface ContextBudgetEvaluation {
  budgetTokens: number;
  decision: ContextBudgetDecision;
  estimatedPromptTokens: number;
  partition: ContextMessagePartition;
  payloadFingerprint: string;
  tailTokens: number;
  trace: ContextBudgetTraceRecord;
  window: EffectiveContextWindow;
}

export interface ContextBudgetCompressionMetadata {
  attempt: 1;
  candidateIds: string[];
  payloadFingerprint: string;
  preservedIds: string[];
  trigger: ContextBudgetTrigger;
}

export const normalizeCompressionAttempt = (attempt?: number): CompressionAttempt =>
  attempt === 1 ? 1 : 0;
