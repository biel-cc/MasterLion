import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatEligibleModelList } from '@/components/ModelSelect';
import { useConversationStore } from '@/features/Conversation/store';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetFailurePayload,
  type ContextBudgetTranslationKey,
  type ContextBudgetUIAction,
} from '@/features/Conversation/utils/contextBudgetView';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { messageService } from '@/services/message';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { useRetryParentMessage } from '../useRetryParentMessage';
import ContextBudgetErrorCard from './ContextBudgetErrorCard';

export type ContextBudgetActionHandler = () => Promise<void> | void;

/**
 * Recovery actions are exposed as callbacks so the integration layer can wire them to the
 * conversation lifecycle. Actions without a handler are not rendered; the guidance text still
 * tells the user what to do by hand.
 */
export interface ContextBudgetErrorCallbacks {
  onDetachAttachments?: ContextBudgetActionHandler;
  onForkTopic?: ContextBudgetActionHandler;
  /** Overrides the default "compact then regenerate" retry used for `SUMMARY_FAILED`. */
  onRetryCompression?: ContextBudgetActionHandler;
  onSwitchCompressionModel?: ContextBudgetActionHandler;
  onSwitchModel?: ContextBudgetActionHandler;
  onTruncateToolResults?: ContextBudgetActionHandler;
}

export interface ContextBudgetErrorProps {
  callbacks?: ContextBudgetErrorCallbacks;
  failure: ContextBudgetFailurePayload;
  id: string;
}

const ContextBudgetError = memo<ContextBudgetErrorProps>(({ callbacks, failure, id }) => {
  const { t: tr } = useTranslation('error');
  const { allowed: canCreate } = usePermission('create_content');
  const context = useConversationStore((s) => s.context);
  const {
    disabled: retryDisabled,
    loading: retryLoading,
    parentId,
    retryParentMessage,
  } = useRetryParentMessage(id);
  const [pendingAction, setPendingAction] = useState<ContextBudgetUIAction>();
  const [actionErrorKey, setActionErrorKey] = useState<ContextBudgetTranslationKey>();
  const [compressionModelSwitcherOpen, setCompressionModelSwitcherOpen] = useState(false);
  const replaceMessages = useConversationStore((s) => s.replaceMessages);
  const updateMessageContent = useConversationStore((s) => s.updateMessageContent);
  const toolResultIds = useConversationStore((s) =>
    s.dbMessages.filter((message) => message.role === 'tool').map((message) => message.id),
  );
  const agentId = typeof context?.agentId === 'string' ? context.agentId : '';
  const [compressionModelId, provider, updateAgentConfigById] = useAgentStore((s) => {
    const config = agentByIdSelectors.getAgentConfigById(agentId)(s);
    return [
      config?.chatConfig?.compressionModelId ?? config?.model ?? '',
      config?.provider ?? '',
      s.updateAgentConfigById,
    ] as const;
  });
  const chatModelList = useChatEligibleModelList();
  // ChatConfig currently stores only a compression model id, so the picker is intentionally
  // limited to the conversation provider. This prevents selecting an unusable cross-provider id.
  const compressionModelList = useMemo(
    () => chatModelList.filter((item) => item.id === provider),
    [chatModelList, provider],
  );

  const canCompact = canCreate && Boolean(context?.topicId) && !retryDisabled;

  // Same recovery path as the legacy exceeded-context card: compact, then regenerate the parent.
  const compactAndRetry = useCallback(async () => {
    if (!canCompact) return;
    await retryParentMessage(() => useChatStore.getState().executeCompression(context, ''));
  }, [canCompact, context, retryParentMessage]);

  const openModelSwitcher = useCallback(() => {
    const trigger = document.querySelector<HTMLElement>('[data-chat-model-switcher-trigger]');
    trigger?.focus();
    trigger?.click();
  }, []);

  const openCompressionModelSwitcher = useCallback(() => {
    setCompressionModelSwitcherOpen(true);
  }, []);

  const updateCompressionModel = useCallback(
    async ({ model, provider: selectedProvider }: { model: string; provider: string }) => {
      if (!agentId || selectedProvider !== provider) return;

      try {
        await updateAgentConfigById(
          agentId,
          { chatConfig: { compressionModelId: model } },
          { throwOnError: true },
        );
        setActionErrorKey(undefined);
        setCompressionModelSwitcherOpen(false);
      } catch (error) {
        console.error('[ContextBudgetError] compression model update failed:', error);
        setActionErrorKey('contextBudget.actionFailed');
      }
    },
    [agentId, provider, updateAgentConfigById],
  );

  const detachAttachmentsAndRetry = useCallback(async () => {
    if (!canCreate || !parentId) return;
    await retryParentMessage(async () => {
      const result = await messageService.updateMessage(parentId, { imageList: [] }, context);
      if (result?.success && result.messages) replaceMessages(result.messages);
    });
  }, [canCreate, context, parentId, replaceMessages, retryParentMessage]);

  const truncateToolResultsAndRetry = useCallback(async () => {
    if (!canCreate || !parentId) return;
    await retryParentMessage(async () => {
      // The placeholder is persisted as message content, so it is localized at write time.
      const placeholder = tr('contextBudget.toolResultPlaceholder');
      for (const toolResultId of toolResultIds) {
        await updateMessageContent(toolResultId, placeholder);
      }
    });
  }, [canCreate, parentId, retryParentMessage, toolResultIds, tr, updateMessageContent]);

  const forkTopic = useCallback(async () => {
    if (!canCreate || !context?.topicId) return;
    // A duplicate carries the same oversized history and immediately reproduces the failure.
    // Start a clean draft instead; its first successful send creates the new branch topic.
    await useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
  }, [canCreate, context?.topicId]);

  const handlers = useMemo<Partial<Record<ContextBudgetUIAction, ContextBudgetActionHandler>>>(
    () => ({
      detach_attachments: callbacks?.onDetachAttachments ?? detachAttachmentsAndRetry,
      fork_topic: callbacks?.onForkTopic ?? (context?.topicId ? forkTopic : undefined),
      retry_compression: callbacks?.onRetryCompression ?? compactAndRetry,
      switch_compression_model: callbacks?.onSwitchCompressionModel ?? openCompressionModelSwitcher,
      switch_model: callbacks?.onSwitchModel ?? openModelSwitcher,
      truncate_tool_results: callbacks?.onTruncateToolResults ?? truncateToolResultsAndRetry,
    }),
    [
      callbacks,
      compactAndRetry,
      context?.topicId,
      detachAttachmentsAndRetry,
      forkTopic,
      openCompressionModelSwitcher,
      openModelSwitcher,
      truncateToolResultsAndRetry,
    ],
  );

  const renderAction = useCallback(
    (action: ContextBudgetUIAction, button: ReactNode) => {
      if (
        action !== 'switch_compression_model' ||
        callbacks?.onSwitchCompressionModel ||
        !agentId ||
        !provider
      ) {
        return button;
      }

      return (
        <ModelSwitchPanel
          enabledList={compressionModelList}
          model={compressionModelId}
          open={compressionModelSwitcherOpen}
          openOnHover={false}
          placement={'bottomLeft'}
          provider={provider}
          onModelChange={updateCompressionModel}
          onOpenChange={setCompressionModelSwitcherOpen}
        >
          {button}
        </ModelSwitchPanel>
      );
    },
    [
      agentId,
      callbacks?.onSwitchCompressionModel,
      compressionModelId,
      compressionModelList,
      compressionModelSwitcherOpen,
      provider,
      updateCompressionModel,
    ],
  );

  const viewModel = useMemo(
    () =>
      buildContextBudgetErrorViewModel(failure, {
        availableActions: (Object.keys(handlers) as ContextBudgetUIAction[]).filter(
          (action) => handlers[action],
        ),
        disabledActions: !canCreate
          ? (Object.keys(handlers) as ContextBudgetUIAction[])
          : !callbacks?.onRetryCompression && !canCompact
            ? ['retry_compression']
            : [],
      }),
    [callbacks?.onRetryCompression, canCompact, canCreate, failure, handlers],
  );

  // A recovery action runs against the network and can fail. Swallowing that rejection would
  // leave an unhandled promise and a card that looks like the retry worked.
  const handleAction = useCallback(
    async (action: ContextBudgetUIAction) => {
      const handler = handlers[action];
      if (!handler) return;

      setPendingAction(action);
      setActionErrorKey(undefined);
      try {
        await handler();
      } catch (error) {
        console.error('[ContextBudgetError] recovery action failed:', action, error);
        setActionErrorKey('contextBudget.actionFailed');
      } finally {
        setPendingAction(undefined);
      }
    },
    [handlers],
  );

  return (
    <ContextBudgetErrorCard
      actionErrorKey={actionErrorKey}
      loadingAction={retryLoading ? 'retry_compression' : pendingAction}
      renderAction={renderAction}
      viewModel={viewModel}
      onAction={handleAction}
    />
  );
});

ContextBudgetError.displayName = 'ContextBudgetError';

export default ContextBudgetError;
