import { memo, useCallback, useMemo, useState } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import {
  buildContextBudgetErrorViewModel,
  type ContextBudgetFailurePayload,
  type ContextBudgetUIAction,
} from '@/features/Conversation/utils/contextBudgetView';
import { usePermission } from '@/hooks/usePermission';
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
    retryParentMessage,
  } = useRetryParentMessage(id);
  const [pendingAction, setPendingAction] = useState<ContextBudgetUIAction>();

  const canCompact = canCreate && Boolean(context?.topicId) && !retryDisabled;

  // Same recovery path as the legacy exceeded-context card: compact, then regenerate the parent.
  const compactAndRetry = useCallback(async () => {
    if (!canCompact) return;
    await retryParentMessage(() => useChatStore.getState().executeCompression(context, ''));
  }, [canCompact, context, retryParentMessage]);

  const handlers = useMemo<Partial<Record<ContextBudgetUIAction, ContextBudgetActionHandler>>>(
    () => ({
      detach_attachments: callbacks?.onDetachAttachments,
      fork_topic: callbacks?.onForkTopic,
      retry_compression: callbacks?.onRetryCompression ?? compactAndRetry,
      switch_compression_model: callbacks?.onSwitchCompressionModel,
      switch_model: callbacks?.onSwitchModel,
      truncate_tool_results: callbacks?.onTruncateToolResults,
    }),
    [callbacks, compactAndRetry],
  );

  const viewModel = useMemo(
    () =>
      buildContextBudgetErrorViewModel(failure, {
        availableActions: (Object.keys(handlers) as ContextBudgetUIAction[]).filter(
          (action) => handlers[action],
        ),
        disabledActions:
          !callbacks?.onRetryCompression && !canCompact ? ['retry_compression'] : [],
      }),
    [callbacks?.onRetryCompression, canCompact, failure, handlers],
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
