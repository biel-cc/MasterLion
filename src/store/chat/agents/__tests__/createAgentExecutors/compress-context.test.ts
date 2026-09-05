import { countContextTokens } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import {
  resolveClientCompressionBudget,
  runClientContextCompressionTransaction,
} from '@/store/chat/agents/clientContextCompression';

import { createAssistantMessage, createMockStore, createUserMessage } from './fixtures';
import { createInitialState, createTestContext, executeWithMockContext } from './helpers';

vi.mock('@/services/chat', () => ({
  collectClientProviderMediaTokenEstimates: vi.fn(() => []),
  chatService: {
    createAssistantMessageStream: vi.fn(),
    getChatCompletion: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    cancelCompression: vi.fn(),
    createCompressionGroup: vi.fn(),
    failCompression: vi.fn(),
    finalizeCompression: vi.fn(),
    updateMessage: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: { currentActiveTopicSummary: vi.fn() },
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: vi.fn(() => ({ uploadBase64FileWithProgress: vi.fn() })),
}));

vi.mock('@/store/agent/selectors', () => ({ agentByIdSelectors: {} }));
vi.mock('@/store/agent/store', () => ({ getAgentStoreState: vi.fn(() => ({})) }));

describe('compress_context executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never raises a small compression window above its post-reserve budget', () => {
    expect(
      resolveClientCompressionBudget(
        { model: 'tiny-model', provider: 'openai' },
        {
          compressionModelCatalogSnapshot: {
            entry: { contextWindowTokens: 1024, modelId: 'tiny-model', providerId: 'openai' },
          },
        },
      ),
    ).toBe(1);
  });

  it('deletes a temporary group on user cancellation instead of recording a false failure', async () => {
    const abortController = new AbortController();
    const cancelGroup = vi.fn().mockResolvedValue(undefined);
    const failGroup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(chatService.getChatCompletion).mockImplementation(async () => {
      abortController.abort();
      return new Response();
    });

    const result = await runClientContextCompressionTransaction({
      abortController,
      candidateIds: ['old-user'],
      compressionModel: { model: 'gpt-4', provider: 'openai' },
      createGroup: vi.fn().mockResolvedValue({ messageGroupId: 'temporary-group' }),
      failGroup,
      finalizeGroup: vi.fn(),
      rollbackGroup: cancelGroup,
      sourceMessages: [createUserMessage({ content: 'old history', id: 'old-user' })],
      trigger: 'manual',
    });

    expect(result.kind).toBe('failed');
    expect(cancelGroup).toHaveBeenCalledWith('temporary-group');
    expect(failGroup).not.toHaveBeenCalled();
  });

  it('uses bounded hierarchical requests and only replaces messages after finalize', async () => {
    const context = createTestContext();
    const oldUser = createUserMessage({ content: 'a'.repeat(30_000), id: 'old-user' });
    const oldAssistant = createAssistantMessage({
      content: 'b'.repeat(30_000),
      id: 'old-assistant',
    });
    const latest = createUserMessage({ content: 'continue', id: 'latest-user' });
    const finalizedMessages = [
      createUserMessage({ content: 'persisted summary', id: 'compression-group' }),
      latest,
    ];
    const replaceMessages = vi.fn((messages: any[]) => {
      mockStore.dbMessagesMap[context.messageKey] = messages;
    });
    const mockStore = createMockStore({ replaceMessages } as any);
    mockStore.dbMessagesMap[context.messageKey] = [oldUser, oldAssistant, latest];
    vi.mocked(messageService.createCompressionGroup).mockResolvedValue({
      messageGroupId: 'compression-group',
      messages: [],
      messagesToSummarize: [oldUser, oldAssistant],
    });
    vi.mocked(messageService.finalizeCompression).mockImplementation(async () => {
      expect(replaceMessages).not.toHaveBeenCalled();
      return { messages: finalizedMessages };
    });
    const requestTokens: number[] = [];
    vi.mocked(chatService.getChatCompletion).mockImplementation(async (request: any, options) => {
      requestTokens.push(countContextTokens({ messages: request.messages }).adjustedTotal);
      await options?.onMessageHandle?.({ text: `summary-${requestTokens.length}`, type: 'text' });
      return new Response();
    });

    const result = await executeWithMockContext({
      context,
      executor: 'compress_context',
      instruction: {
        payload: {
          candidateIds: ['old-user', 'old-assistant'],
          catalogSnapshot: {
            capturedAt: '2026-09-04T00:00:00.000Z',
            entry: {
              abilitySources: {},
              contextWindowSource: 'catalog',
              contextWindowTokens: 3072,
              inputModalities: {
                audio: 'unknown',
                file: 'unknown',
                image: 'unknown',
                text: 'supported',
                video: 'unknown',
              },
              kind: 'chat',
              kindSource: 'catalog',
              modelId: 'gpt-4',
              providerId: 'openai',
            },
            operationId: context.operationId,
            version: 1,
          },
          currentTokenCount: 20_000,
          messages: [oldUser, oldAssistant, latest],
          payloadFingerprint: 'input-fingerprint',
          trigger: 'threshold',
        },
        type: 'compress_context',
      } as any,
      mockStore,
      state: createInitialState({
        metadata: {
          modelCatalogSnapshot: {
            entry: { contextWindowTokens: 3072, modelId: 'gpt-4', providerId: 'openai' },
          },
        },
        modelRuntimeConfig: {
          compressionModel: { model: 'gpt-4', provider: 'openai' },
          model: 'gpt-4',
          provider: 'openai',
        },
        operationId: context.operationId,
      }),
    });

    expect(requestTokens.length).toBeGreaterThan(1);
    expect(requestTokens.every((tokens) => tokens <= 2048)).toBe(true);
    expect(messageService.finalizeCompression).toHaveBeenCalledTimes(1);
    expect(messageService.cancelCompression).not.toHaveBeenCalled();
    expect(messageService.failCompression).not.toHaveBeenCalled();
    expect(replaceMessages).toHaveBeenCalledTimes(1);
    expect(result.nextContext?.payload).toEqual(
      expect.objectContaining({
        compressedMessages: finalizedMessages,
        outcome: 'compressed',
        payloadFingerprint: 'input-fingerprint',
      }),
    );
  });
});
