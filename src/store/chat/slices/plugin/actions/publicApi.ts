import {
  type BuiltinToolResult,
  type ChatToolPayload,
  type RuntimeStepContext,
} from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../message/selectors';

/**
 * Public API for plugin operations
 * These methods are called by UI components or other business scenarios
 */

type Setter = StoreSetter<ChatStore>;
export const pluginPublicApi = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginPublicApiActionImpl(set, get, _api);

export class PluginPublicApiActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  reInvokeToolMessage = async (id: string): Promise<void> => {
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message || message.role !== 'tool' || !message.plugin) return;

    // Get operationId from messageOperationMap
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // if there is error content, then clear the error
    if (!!message.pluginError) {
      this.#get().optimisticUpdateMessagePluginError(id, null, context);
    }

    const payload: ChatToolPayload = { ...message.plugin, id: message.tool_call_id! };

    await this.#get().internal_invokeDifferentTypePlugin(id, payload);
  };

  internal_invokeDifferentTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    switch (payload.type) {
      // @ts-ignore
      case 'mcp': {
        return await this.#get().invokeMCPTypePlugin(id, payload);
      }

      default: {
        // Pass stepContext to builtin tools for dynamic state access
        return await this.#get().invokeBuiltinTool(id, payload, stepContext);
      }
    }
  };

  /**
   * Execute one tool call without archiving or mutating its message.
   *
   * Persistence belongs to the caller's lifecycle so a local execution cannot be repeated merely
   * because synchronizing its result failed. Keep re-invocation on the legacy method above because
   * that UI flow intentionally executes and persists in one action.
   */
  internal_executeDifferentTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
    signal?: AbortSignal,
  ): Promise<BuiltinToolResult> => {
    switch (payload.type) {
      // @ts-ignore legacy MCP payloads are not represented in every ChatToolPayload variant
      case 'mcp': {
        return await this.#get().internal_executeMCPTypePlugin(id, payload, signal);
      }

      default: {
        return await this.#get().internal_executeBuiltinTool(id, payload, stepContext, signal);
      }
    }
  };
}

export type PluginPublicApiAction = Pick<
  PluginPublicApiActionImpl,
  keyof PluginPublicApiActionImpl
>;
