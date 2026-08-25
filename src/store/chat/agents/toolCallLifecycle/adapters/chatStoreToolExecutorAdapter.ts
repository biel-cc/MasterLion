import { type BuiltinToolResult, type RuntimeStepContext } from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';

import { type ToolCallLifecycleDependencies } from '../ToolCallLifecycle';

type ExecutorPort = ToolCallLifecycleDependencies['executor'];

/** Execute the tool only; persistence is owned by the lifecycle message adapter. */
export const createChatStoreToolExecutorAdapter = (get: () => ChatStore): ExecutorPort => ({
  execute: async ({ messageId, signal, stepContext, toolCall }) => {
    const result = await get().internal_executeDifferentTypePlugin(
      messageId,
      toolCall,
      stepContext as RuntimeStepContext | undefined,
      signal,
    );

    if (!result) {
      throw new Error(`Tool ${toolCall.identifier}/${toolCall.apiName} completed without a result`);
    }

    return result as BuiltinToolResult;
  },
});
