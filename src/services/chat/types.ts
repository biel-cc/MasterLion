import type {
  ContextBudgetCompressionResult,
  ContextBudgetEvaluation,
  FinalContextPayload,
} from '@lobechat/agent-runtime';
import type { FetchSSEOptions } from '@lobechat/fetch-sse';
import type {
  ChatStreamPayload,
  RequestTrigger,
  RuntimeInitialContext,
  RuntimeStepContext,
  TracePayload,
} from '@lobechat/types';
import type { ContextBudgetAttemptState } from '@lobechat/types/src/contextBudget';
import type { ModelCatalogSnapshot } from '@lobechat/types/src/modelCatalog';

interface ChatRequestMetadata extends Record<string, unknown> {
  trigger?: RequestTrigger;
}

export type ClientBudgetedChatPayload = Partial<Omit<ChatStreamPayload, 'messages'>> &
  FinalContextPayload;

/** Operation-frozen budget inputs used by the in-process client runtime. */
export interface ClientContextBudgetOptions {
  attemptState?: Partial<ContextBudgetAttemptState>;
  catalogSnapshot?: ModelCatalogSnapshot;
  compress: (
    payload: ClientBudgetedChatPayload,
    evaluation: ContextBudgetEvaluation,
  ) => Promise<ContextBudgetCompressionResult<ClientBudgetedChatPayload>>;
  configuredWindowTokens?: number;
  onAttemptState?: (state: ContextBudgetAttemptState) => void;
  /** Discard partial stream state from a provider attempt that exceeded context. */
  onProviderAttemptDiscard?: (input: {
    attempt: 1 | 2;
    error: unknown;
    willRetry: boolean;
  }) => Promise<void> | void;
  operationId: string;
  outputReserveTokens?: number;
}

export interface FetchOptions extends FetchSSEOptions {
  agentId?: string;
  contextBudget?: ClientContextBudgetOptions;
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  metadata?: ChatRequestMetadata;
  signal?: AbortSignal | undefined;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  topicId?: string;
  trace?: TracePayload;
}
