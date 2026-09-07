import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIStream } from './openai';
import { OpenAIResponsesStream } from './responsesStream';

const createAbortingSSEFetch = (event: unknown, abort: () => void) =>
  (async () => {
    const encoder = new TextEncoder();
    let sentFirstChunk = false;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sentFirstChunk) {
          sentFirstChunk = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          return;
        }

        abort();
        controller.error(new DOMException('The operation was aborted', 'AbortError'));
      },
    });

    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;

const readSSE = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  let output = '';

  for await (const chunk of stream) output += decoder.decode(chunk, { stream: true });
  return output + decoder.decode();
};

describe('OpenAI SDK abort handling', () => {
  it('emits upstream_timeout when Chat Completions SDK swallows AbortError as done', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          choices: [{ delta: { content: 'partial' }, finish_reason: null, index: 0 }],
          created: 1,
          id: 'completion-1',
          model: 'compat-model',
          object: 'chat.completion.chunk',
        },
        () =>
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          ),
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.chat.completions.create(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'compat-model',
        stream: true,
      },
      { signal: combinedSignal },
    )) as Stream<OpenAI.ChatCompletionChunk>;
    const [productionStream] = sdkStream.tee();
    const onCompletion = vi.fn();
    const onError = vi.fn();
    const onFinal = vi.fn();

    const output = await readSSE(
      OpenAIStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onCompletion, onError, onFinal },
        operationId: 'operation-chat-sdk',
        payload: { model: 'compat-model', provider: 'newapi' },
      }),
    );

    expect(output).toContain('event: text\n');
    expect(output).toContain('event: error\n');
    expect(output).toContain('"type":"upstream_timeout"');
    expect(onError).toHaveBeenCalledOnce();
    expect(onCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ type: 'upstream_timeout' }),
        text: 'partial',
      }),
    );
    expect(onFinal).toHaveBeenCalledOnce();
  });

  it('does not treat intermediate usage as completion before a swallowed timeout', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          choices: [{ delta: { content: 'partial' }, finish_reason: null, index: 0 }],
          created: 1,
          id: 'completion-with-intermediate-usage',
          model: 'compat-model',
          object: 'chat.completion.chunk',
          usage: { completion_tokens: 1, prompt_tokens: 10, total_tokens: 11 },
        },
        () =>
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          ),
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.chat.completions.create(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'compat-model',
        stream: true,
      },
      { signal: combinedSignal },
    )) as Stream<OpenAI.ChatCompletionChunk>;
    const [productionStream] = sdkStream.tee();
    const onCompletion = vi.fn();
    const onError = vi.fn();

    const output = await readSSE(
      OpenAIStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onCompletion, onError },
        operationId: 'operation-intermediate-usage-sdk',
        payload: { model: 'compat-model', provider: 'newapi' },
      }),
    );

    expect(output).toContain('event: text\n');
    expect(output).toContain('event: error\n');
    expect(output).toContain('"type":"upstream_timeout"');
    expect(onError).toHaveBeenCalledOnce();
    expect(onCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ type: 'upstream_timeout' }) }),
    );
  });

  it('emits upstream_timeout when Responses SDK swallows AbortError as done', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          content_index: 0,
          delta: 'partial',
          item_id: 'item-1',
          output_index: 0,
          type: 'response.output_text.delta',
        },
        () =>
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          ),
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.responses.create(
      { input: 'hello', model: 'compat-model', stream: true },
      { signal: combinedSignal },
    )) as Stream<OpenAI.Responses.ResponseStreamEvent>;
    const [productionStream] = sdkStream.tee();
    const onError = vi.fn();
    const onFinal = vi.fn();

    const output = await readSSE(
      OpenAIResponsesStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onError, onFinal },
        operationId: 'operation-responses-sdk',
        payload: { apiMode: 'responses', model: 'compat-model', provider: 'newapi' },
      }),
    );

    expect(output).toContain('event: text\n');
    expect(output).toContain('event: error\n');
    expect(output).toContain('"type":"upstream_timeout"');
    expect(onError).toHaveBeenCalledOnce();
    expect(onFinal).toHaveBeenCalledOnce();
  });

  it('keeps user cancellation as stop abort when the SDK swallows AbortError as done', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          choices: [{ delta: { content: 'partial' }, finish_reason: null, index: 0 }],
          created: 1,
          id: 'completion-user-abort',
          model: 'compat-model',
          object: 'chat.completion.chunk',
        },
        () => {
          requestController.abort(new DOMException('The user stopped generation', 'AbortError'));
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          );
        },
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.chat.completions.create(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'compat-model',
        stream: true,
      },
      { signal: combinedSignal },
    )) as Stream<OpenAI.ChatCompletionChunk>;
    const [productionStream] = sdkStream.tee();
    const onError = vi.fn();

    const output = await readSSE(
      OpenAIStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onError },
        operationId: 'operation-user-abort-sdk',
      }),
    );

    expect(output).toContain('event: text\n');
    expect(output).toContain('event: stop\n');
    expect(output).toContain('data: "abort"\n\n');
    expect(output).not.toContain('event: error\n');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not report timeout after a normal Chat Completions terminal chunk', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
          created: 1,
          id: 'completion-normal-stop',
          model: 'compat-model',
          object: 'chat.completion.chunk',
        },
        () =>
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          ),
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.chat.completions.create(
      {
        messages: [{ content: 'hello', role: 'user' }],
        model: 'compat-model',
        stream: true,
      },
      { signal: combinedSignal },
    )) as Stream<OpenAI.ChatCompletionChunk>;
    const [productionStream] = sdkStream.tee();
    const onError = vi.fn();

    const output = await readSSE(
      OpenAIStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onError },
        operationId: 'operation-normal-stop-sdk',
      }),
    );

    expect(output).toContain('event: stop\n');
    expect(output).toContain('data: "stop"\n\n');
    expect(output).not.toContain('event: error\n');
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not report timeout after a normal Responses terminal event', async () => {
    const requestController = new AbortController();
    const totalController = new AbortController();
    const combinedSignal = AbortSignal.any([
      requestController.signal,
      totalController.signal,
    ]);
    const client = new OpenAI({
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      dangerouslyAllowBrowser: true,
      fetch: createAbortingSSEFetch(
        {
          response: {
            id: 'response-normal-completion',
            model: 'compat-model',
            status: 'completed',
            usage: null,
          },
          type: 'response.completed',
        },
        () =>
          totalController.abort(
            new DOMException('Upstream model request exceeded the total timeout', 'TimeoutError'),
          ),
      ),
      maxRetries: 0,
    });
    const sdkStream = (await client.responses.create(
      { input: 'hello', model: 'compat-model', stream: true },
      { signal: combinedSignal },
    )) as Stream<OpenAI.Responses.ResponseStreamEvent>;
    const [productionStream] = sdkStream.tee();
    const onError = vi.fn();

    const output = await readSSE(
      OpenAIResponsesStream(productionStream, {
        abortSignal: combinedSignal,
        abortSignals: {
          requestSignal: requestController.signal,
          totalSignal: totalController.signal,
        },
        callbacks: { onError },
        operationId: 'operation-normal-responses-sdk',
        payload: { apiMode: 'responses', model: 'compat-model', provider: 'newapi' },
      }),
    );

    expect(output).not.toContain('event: error\n');
    expect(output).not.toContain('upstream_timeout');
    expect(onError).not.toHaveBeenCalled();
  });
});
