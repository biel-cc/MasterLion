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
const regenerateUserMessageMock = vi.fn();
const storeState = vi.hoisted(() => ({
  context: { agentId: 'agent-1', topicId: 'topic-1' } as Record<string, unknown>,
  displayMessages: [{ id: 'assistant-1', parentId: 'user-1' }] as Array<{
    id: string;
    parentId?: string;
  }>,
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

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({ executeCompression: executeCompressionMock }),
  },
}));

vi.mock('@/features/Conversation/store', () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      context: storeState.context,
      displayMessages: storeState.displayMessages,
      regenerateUserMessage: regenerateUserMessageMock,
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
    regenerateUserMessageMock.mockReset().mockResolvedValue(undefined);
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
    // Unwired actions are not rendered; the hint list still guides the user.
    expect(screen.queryByRole('button', { name: 'contextBudget.action.switchModel' })).toBeNull();
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

    expect(screen.queryByRole('button', { name: 'contextBudget.action.retryCompression' })).toBeNull();
    expect(executeCompressionMock).not.toHaveBeenCalled();
    expect(regenerateUserMessageMock).not.toHaveBeenCalled();

    fireEvent.click(button('contextBudget.action.switchModel'));
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
  });

  it('TAIL_TOO_LARGE renders guidance only until the integration wires callbacks', () => {
    render(<ContextBudgetError failure={failure('TAIL_TOO_LARGE')} id={'assistant-1'} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('list', { name: 'contextBudget.hintsLabel' })).toBeInTheDocument();
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
});
