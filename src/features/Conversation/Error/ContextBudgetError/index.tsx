import { memo, useCallback, useMemo, useState } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetFailurePayload,
  type ContextBudgetUIAction,
} from '@/features/Conversation/utils/contextBudgetView';
import { usePermission } from '@/hooks/usePermission';
import { messageService } from '@/services/message';
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
  const { allowed: canCreate } = usePermission('create_content');
  const context = useConversationStore((s) => s.context);
  const {
    disabled: retryDisabled,
    loading: retryLoading,
    parentId,
    retryParentMessage,
  } = useRetryParentMessage(id);
  const [pendingAction, setPendingAction] = useState<ContextBudgetUIAction>();
  const replaceMessages = useConversationStore((s) => s.replaceMessages);
  const updateMessageContent = useConversationStore((s) => s.updateMessageContent);
  const toolResultIds = useConversationStore((s) =>
    s.dbMessages.filter((message) => message.role === 'tool').map((message) => message.id),
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
      for (const toolResultId of toolResultIds) {
        await updateMessageContent(toolResultId, '[Tool result removed to reduce context size]');
      }
    });
  }, [canCreate, parentId, retryParentMessage, toolResultIds, updateMessageContent]);

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
      // Compression currently uses the conversation model. Both actions open
      // the same model chooser until a dedicated compression-model control is
      // introduced, so the recovery is real rather than a dead button.
      switch_compression_model: callbacks?.onSwitchCompressionModel ?? openModelSwitcher,
      switch_model: callbacks?.onSwitchModel ?? openModelSwitcher,
      truncate_tool_results: callbacks?.onTruncateToolResults ?? truncateToolResultsAndRetry,
    }),
    [
      callbacks,
      compactAndRetry,
      context?.topicId,
      detachAttachmentsAndRetry,
      forkTopic,
      openModelSwitcher,
      truncateToolResultsAndRetry,
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

  const handleAction = useCallback(
    async (action: ContextBudgetUIAction) => {
      const handler = handlers[action];
      if (!handler) return;

      setPendingAction(action);
      try {
        await handler();
      } finally {
        setPendingAction(undefined);
      }
    },
    [handlers],
  );

  return (
    <ContextBudgetErrorCard
      loadingAction={retryLoading ? 'retry_compression' : pendingAction}
      viewModel={viewModel}
      onAction={handleAction}
    />
  );
});

ContextBudgetError.displayName = 'ContextBudgetError';

export default ContextBudgetError;
