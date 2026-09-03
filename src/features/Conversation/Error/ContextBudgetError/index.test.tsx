/**
 * @vitest-environment happy-dom
 */
import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import { MotionProvider } from '@lobehub/ui';
import {
  act,
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
} from '@testing-library/react';
import * as m from 'motion/react-m';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextBudgetFailurePayload } from '@/features/Conversation/utils/contextBudgetView';

import ContextBudgetError from './index';

// Same motion provider the app installs in AppTheme; base-ui Button requires it.
const Wrapper = ({ children }: { children: ReactNode }) => (
  <MotionProvider motion={m}>{children}</MotionProvider>
);
const render = (ui: ReactElement) => renderBase(ui, { wrapper: Wrapper });

const executeCompressionMock = vi.fn();
const switchTopicMock = vi.fn();
const replaceMessagesMock = vi.fn();
const regenerateUserMessageMock = vi.fn();
const updateMessageContentMock = vi.fn();
const updateAgentConfigByIdMock = vi.fn();
const storeState = vi.hoisted(() => ({
  context: { agentId: 'agent-1', topicId: 'topic-1' } as Record<string, unknown>,
  dbMessages: [{ id: 'tool-1', role: 'tool' }] as Array<{ id: string; role: string }>,
  displayMessages: [{ id: 'assistant-1', parentId: 'user-1' }] as Array<{
    id: string;
    parentId?: string;
  }>,
  updateMessage: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/components/ModelSelect', () => ({
  useChatEligibleModelList: () => [
    { id: 'aihub', models: [{ id: 'main-model' }, { id: 'summary-model' }] },
    { id: 'other-provider', models: [{ id: 'other-model' }] },
  ],
}));

vi.mock('@/features/ModelSwitchPanel', () => ({
  default: ({ children, enabledList, onModelChange, open }: any) => (
    <div data-enabled-providers={enabledList.map((item: any) => item.id).join(',')}>
      {children}
      {open && (
        <button
          type={'button'}
          onClick={() => onModelChange({ model: 'summary-model', provider: 'aihub' })}
        >
          choose-summary-model
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: any) => unknown) =>
    selector({
      agentMap: {
        'agent-1': {
          chatConfig: {},
          model: 'main-model',
          provider: 'aihub',
        },
      },
      updateAgentConfigById: updateAgentConfigByIdMock,
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      executeCompression: executeCompressionMock,
      switchTopic: switchTopicMock,
    }),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: { updateMessage: storeState.updateMessage },
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      context: storeState.context,
      dbMessages: storeState.dbMessages,
      displayMessages: storeState.displayMessages,
      regenerateUserMessage: regenerateUserMessageMock,
      replaceMessages: replaceMessagesMock,
      updateMessageContent: updateMessageContentMock,
    }),
}));

const failure = (
  code: ContextBudgetFailCode,
  actions: ContextBudgetFailurePayload['decision']['actions'] = [
    'truncate_tool_results',
    'detach_attachments',
    'switch_model',
    'fork_topic',
  ],
): ContextBudgetFailurePayload => ({
  decision: { actions, code, kind: 'fail', offending: [{ estimatedTokens: 10, source: 'text' }] },
  trace: { attempt: 1, modelId: 'gpt-4o-mini', providerId: 'aihub' },
});

const button = (name: string) => screen.getByRole('button', { name });

describe('<ContextBudgetError />', () => {
  beforeEach(() => {
    executeCompressionMock.mockReset().mockResolvedValue(undefined);
    switchTopicMock.mockReset().mockResolvedValue(undefined);
    replaceMessagesMock.mockReset();
    regenerateUserMessageMock.mockReset().mockResolvedValue(undefined);
    updateMessageContentMock.mockReset().mockResolvedValue(undefined);
    updateAgentConfigByIdMock.mockReset().mockResolvedValue(undefined);
    storeState.updateMessage.mockReset().mockResolvedValue({ messages: [], success: true });
    storeState.context = { agentId: 'agent-1', topicId: 'topic-1' };
    storeState.displayMessages = [{ id: 'assistant-1', parentId: 'user-1' }];
  });
  afterEach(() => cleanup());

  it('SUMMARY_FAILED retry compacts the context and regenerates the parent message', async () => {
    render(<ContextBudgetError failure={failure('SUMMARY_FAILED')} id={'assistant-1'} />);

    await act(async () => {
      fireEvent.click(button('contextBudget.action.retryCompression'));
    });

    await waitFor(() => expect(regenerateUserMessageMock).toHaveBeenCalledWith('user-1'));
    expect(executeCompressionMock).toHaveBeenCalledWith(storeState.context, '');
    expect(executeCompressionMock.mock.invocationCallOrder[0]).toBeLessThan(
      regenerateUserMessageMock.mock.invocationCallOrder[0],
    );
  });

  it('disables the summary retry when the conversation has no topic to compact', () => {
    storeState.context = { agentId: 'agent-1' };
    render(<ContextBudgetError failure={failure('SUMMARY_FAILED')} id={'assistant-1'} />);

    expect(button('contextBudget.action.retryCompression')).toBeDisabled();
    fireEvent.click(button('contextBudget.action.retryCompression'));
    expect(executeCompressionMock).not.toHaveBeenCalled();
  });

  it('NO_CANDIDATES keeps re-compress disabled even when a retry callback is wired', () => {
    const onRetryCompression = vi.fn();
    const onForkTopic = vi.fn();
    render(
      <ContextBudgetError
        callbacks={{ onForkTopic, onRetryCompression }}
        failure={failure('NO_CANDIDATES')}
        id={'assistant-1'}
      />,
    );

    const retry = button('contextBudget.action.retryCompression');
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(onRetryCompression).not.toHaveBeenCalled();
    expect(executeCompressionMock).not.toHaveBeenCalled();

    fireEvent.click(button('contextBudget.action.forkTopic'));
    expect(onForkTopic).toHaveBeenCalledTimes(1);
    // Built-in recovery actions stay available without route-level callbacks.
    expect(screen.getByRole('button', { name: 'contextBudget.action.switchModel' })).toBeEnabled();
    expect(screen.getByRole('list', { name: 'contextBudget.hintsLabel' })).toBeInTheDocument();
  });

  it('RETRY_EXHAUSTED never retries automatically and only calls the wired callbacks', () => {
    const onSwitchModel = vi.fn();
    render(
      <ContextBudgetError
        callbacks={{ onSwitchModel }}
        failure={failure('RETRY_EXHAUSTED')}
        id={'assistant-1'}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'contextBudget.action.retryCompression' }),
    ).toBeNull();
    expect(executeCompressionMock).not.toHaveBeenCalled();
    expect(regenerateUserMessageMock).not.toHaveBeenCalled();

    fireEvent.click(button('contextBudget.action.switchModel'));
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
  });

  it('TAIL_TOO_LARGE wires built-in attachment, tool-result, model, and fork recovery', async () => {
    const toolHeavyFailure = failure('TAIL_TOO_LARGE');
    toolHeavyFailure.decision.offending = [{ estimatedTokens: 10, source: 'tool-result' }];
    render(<ContextBudgetError failure={toolHeavyFailure} id={'assistant-1'} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'contextBudget.hintsLabel' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(button('contextBudget.action.detachAttachments'));
    });
    expect(storeState.updateMessage).toHaveBeenCalledWith(
      'user-1',
      { imageList: [] },
      storeState.context,
    );
    expect(regenerateUserMessageMock).toHaveBeenCalledWith('user-1');

    await act(async () => {
      fireEvent.click(button('contextBudget.action.truncateToolResults'));
    });
    expect(updateMessageContentMock).toHaveBeenCalledWith(
      'tool-1',
      '[Tool result removed to reduce context size]',
    );

    await act(async () => {
      fireEvent.click(button('contextBudget.action.forkTopic'));
    });
    expect(switchTopicMock).toHaveBeenCalledWith(null, { skipRefreshMessage: true });
  });

  it('opens the real conversation model switcher for model recovery', () => {
    const trigger = document.createElement('button');
    trigger.dataset.chatModelSwitcherTrigger = '';
    document.body.append(trigger);
    const click = vi.spyOn(trigger, 'click');

    render(<ContextBudgetError failure={failure('RETRY_EXHAUSTED')} id={'assistant-1'} />);
    fireEvent.click(button('contextBudget.action.switchModel'));

    expect(click).toHaveBeenCalledOnce();
    trigger.remove();
  });

  it('opens an independent provider-scoped picker and persists the compression model', async () => {
    render(<ContextBudgetError failure={failure('SUMMARY_FAILED')} id={'assistant-1'} />);

    fireEvent.click(button('contextBudget.action.switchCompressionModel'));
    expect(button('choose-summary-model')).toBeInTheDocument();
    expect(button('choose-summary-model').parentElement).toHaveAttribute(
      'data-enabled-providers',
      'aihub',
    );

    await act(async () => {
      fireEvent.click(button('choose-summary-model'));
    });

    expect(updateAgentConfigByIdMock).toHaveBeenCalledWith(
      'agent-1',
      { chatConfig: { compressionModelId: 'summary-model' } },
      { throwOnError: true },
    );
    expect(screen.queryByRole('button', { name: 'choose-summary-model' })).toBeNull();
  });

  it('keeps the compression picker recoverable and surfaces a failed model update', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateAgentConfigByIdMock.mockRejectedValueOnce(new Error('save failed'));
    render(<ContextBudgetError failure={failure('SUMMARY_FAILED')} id={'assistant-1'} />);

    fireEvent.click(button('contextBudget.action.switchCompressionModel'));
    await act(async () => {
      fireEvent.click(button('choose-summary-model'));
    });

    expect(button('choose-summary-model')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('alert')
        .some((node) => node.textContent === 'contextBudget.actionFailed'),
    ).toBe(true);
    consoleError.mockRestore();
  });

  it('lets the integration override the default summary retry', async () => {
    const onRetryCompression = vi.fn().mockResolvedValue(undefined);
    render(
      <ContextBudgetError
        callbacks={{ onRetryCompression }}
        failure={failure('SUMMARY_FAILED')}
        id={'assistant-1'}
      />,
    );

    await act(async () => {
      fireEvent.click(button('contextBudget.action.retryCompression'));
    });

    expect(onRetryCompression).toHaveBeenCalledTimes(1);
    expect(executeCompressionMock).not.toHaveBeenCalled();
  });

  it('shows a visible failure and leaves no unhandled rejection when a recovery action throws', async () => {
    const unhandled = vi.fn();
    globalThis.addEventListener('unhandledrejection', unhandled);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeCompressionMock.mockRejectedValue(new Error('compaction failed'));

    render(<ContextBudgetError failure={failure('SUMMARY_FAILED')} id={'assistant-1'} />);

    await act(async () => {
      fireEvent.click(button('contextBudget.action.retryCompression'));
    });

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some((node) => node.textContent === 'contextBudget.actionFailed'),
      ).toBe(true),
    );
    // The failed action becomes clickable again rather than staying stuck in a loading state.
    expect(button('contextBudget.action.retryCompression')).toBeEnabled();
    expect(regenerateUserMessageMock).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });
    expect(unhandled).not.toHaveBeenCalled();

    globalThis.removeEventListener('unhandledrejection', unhandled);
    consoleError.mockRestore();
  });
});
