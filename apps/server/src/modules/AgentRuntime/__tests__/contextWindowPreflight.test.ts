import { AgentRuntimeErrorType, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { assertFinalContextWithinWindow, FinalContextWindowError } from '../contextWindowPreflight';

describe('assertFinalContextWithinWindow', () => {
  const message = (content: string): UIChatMessage =>
    ({ content, id: 'message-1', role: 'user' }) as UIChatMessage;

  it('allows requests with completion headroom', () => {
    expect(() =>
      assertFinalContextWithinWindow({
        contextWindowTokens: 8192,
        messages: [message('short request')],
        model: 'test-model',
      }),
    ).not.toThrow();
  });

  it('blocks the final provider request when adjusted input exceeds the window', () => {
    let error: unknown;
    try {
      assertFinalContextWithinWindow({
        contextWindowTokens: 2048,
        messages: [message('large input '.repeat(3000))],
        model: 'test-model',
        tools: [{ description: 'large tool '.repeat(100), name: 'tool' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(FinalContextWindowError);
    expect((error as FinalContextWindowError).errorType).toBe(
      AgentRuntimeErrorType.ExceededContextWindow,
    );
    expect((error as FinalContextWindowError).error.type).toBe('context_exceeded_pre_flight');
    expect((error as FinalContextWindowError).error.suggestions).toContain('enable_data_analysis');
  });
});
