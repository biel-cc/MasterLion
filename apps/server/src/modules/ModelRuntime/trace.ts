import { INBOX_SESSION_ID, LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID } from '@lobechat/const';
import { type ChatStreamCallbacks, type ChatStreamPayload } from '@lobechat/model-runtime';
import { trace as otelTrace } from '@lobechat/observability-otel/api';
import { type TracePayload } from '@lobechat/types';
import { TraceTagMap } from '@lobechat/types';
import { after } from 'next/server';

import { TraceClient } from '@/libs/traces';
import { sanitizeTelemetryValue } from '@/server/services/productTelemetry';

export interface AgentChatOptions {
  enableTrace?: boolean;
  provider: string;
  trace?: TracePayload;
}

export const createTraceOptions = (
  payload: ChatStreamPayload,
  { trace: tracePayload, provider }: AgentChatOptions,
) => {
  const { messages, model, tools, ...parameters } = payload;
  // create a trace to monitor the completion
  const traceClient = new TraceClient();
  if (tracePayload?.traceId) {
    otelTrace.getActiveSpan()?.setAttribute('masterino.trace_id', tracePayload.traceId);
  }
  const messageLength = messages.length;
  const systemRole = messages.find((message) => message.role === 'system')?.content;
  const traceSanitizeOptions = {
    maxArrayItems: 500,
    maxDepth: 8,
    maxObjectKeys: 500,
    maxStringLength: 128 * 1024,
  };
  const sanitizedMessages = sanitizeTelemetryValue(messages, traceSanitizeOptions);
  const sanitizedSystemRole = sanitizeTelemetryValue(systemRole, traceSanitizeOptions);
  const sanitizedTools = sanitizeTelemetryValue(tools, traceSanitizeOptions);

  const trace = traceClient.createTrace({
    id: tracePayload?.traceId,
    input: sanitizedMessages,
    metadata: {
      messageLength,
      model,
      provider,
      systemRole: sanitizedSystemRole,
      tools: sanitizedTools,
    },
    name: tracePayload?.traceName,
    sessionId: tracePayload?.topicId
      ? tracePayload.topicId
      : `${tracePayload?.sessionId || INBOX_SESSION_ID}@default`,
    tags: tracePayload?.tags,
    userId: tracePayload?.userId,
  });

  const generation = trace?.generation({
    input: sanitizedMessages,
    metadata: { messageLength, model, provider },
    model,
    modelParameters: sanitizeTelemetryValue(parameters, traceSanitizeOptions) as any,
    name: `Chat Completion (${provider})`,
    startTime: new Date(),
  });

  const headers = new Headers();

  if (trace?.id) {
    headers.set(LOBE_CHAT_TRACE_ID, trace.id);
  }

  if (generation?.id) {
    headers.set(LOBE_CHAT_OBSERVATION_ID, generation.id);
  }

  return {
    callback: {
      onCompletion: async ({ text, thinking, usage, grounding, toolsCalling }) => {
        const output =
          // if the toolsCalling is not empty, we need to return the toolsCalling
          !!toolsCalling && toolsCalling.length > 0
            ? !!text
              ? // tools calling with thinking and text
                { text, thinking, toolsCalling }
              : toolsCalling
            : !!thinking
              ? { text, thinking }
              : text;

        const sanitizedOutput = sanitizeTelemetryValue(output, traceSanitizeOptions);

        generation?.update({
          endTime: new Date(),
          metadata: sanitizeTelemetryValue({ grounding, thinking }, traceSanitizeOptions) as any,
          output: sanitizedOutput,
          usage: usage
            ? {
                completionTokens: usage.outputTextTokens,
                input: usage.totalInputTokens,
                output: usage.totalOutputTokens,
                promptTokens: usage.inputTextTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        });

        trace?.update({ output: sanitizedOutput });
      },

      onFinal: () => {
        after(async () => {
          try {
            await traceClient.shutdownAsync();
          } catch (e) {
            console.error('TraceClient shutdown error:', e);
          }
        });
      },

      onStart: () => {
        generation?.update({ completionStartTime: new Date() });
      },

      onToolsCalling: async () => {
        trace?.update({
          tags: [...(tracePayload?.tags || []), TraceTagMap.ToolsCalling],
        });
      },
    } as ChatStreamCallbacks,
    headers,
  };
};
