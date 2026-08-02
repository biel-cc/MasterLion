import { countContextTokens } from '@lobechat/context-engine';
import { AgentRuntimeErrorType, type UIChatMessage } from '@lobechat/types';

const MIN_COMPLETION_TOKENS = 1024;

export class FinalContextWindowError extends Error {
  readonly errorType = AgentRuntimeErrorType.ExceededContextWindow;
  readonly error: {
    ctx: number;
    minOutputTokens: number;
    model: string;
    promptTokens: number;
    shortBy: number;
    suggestions: string[];
    type: 'context_exceeded_pre_flight';
  };

  constructor(params: { contextWindowTokens: number; model: string; promptTokens: number }) {
    const { contextWindowTokens, model, promptTokens } = params;
    super(
      `The final request requires approximately ${promptTokens} tokens, leaving insufficient room in the ${contextWindowTokens}-token context window for model "${model}". Enable data analysis for large spreadsheets, reduce attachments or history, or choose a larger-context model.`,
    );
    this.name = 'FinalContextWindowError';
    this.error = {
      ctx: contextWindowTokens,
      minOutputTokens: MIN_COMPLETION_TOKENS,
      model,
      promptTokens,
      shortBy: promptTokens + MIN_COMPLETION_TOKENS - contextWindowTokens,
      suggestions: [
        'enable_data_analysis',
        'reduce_attachments',
        'fork_topic',
        'switch_to_larger_ctx_model',
      ],
      type: 'context_exceeded_pre_flight',
    };
  }
}

/**
 * Last-line budget check after context engineering and tool resolution. The
 * 1.25 drift factor inside countContextTokens reserves tokenizer/protocol
 * headroom; an additional completion reserve prevents a fitting input from
 * leaving no usable output budget.
 */
export const assertFinalContextWithinWindow = ({
  contextWindowTokens,
  messages,
  model,
  tools,
}: {
  contextWindowTokens?: number;
  messages: UIChatMessage[];
  model: string;
  tools?: unknown[];
}) => {
  if (!contextWindowTokens || contextWindowTokens <= 0) return;

  const accounting = countContextTokens({ messages, tools });
  if (accounting.adjustedTotal + MIN_COMPLETION_TOKENS <= contextWindowTokens) return;

  throw new FinalContextWindowError({
    contextWindowTokens,
    model,
    promptTokens: accounting.adjustedTotal,
  });
};
