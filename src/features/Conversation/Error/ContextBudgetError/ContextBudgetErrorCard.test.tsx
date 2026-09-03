/**
 * @vitest-environment happy-dom
 */
import type { ContextBudgetFailCode } from '@lobechat/types/src/contextBudget';
import { MotionProvider } from '@lobehub/ui';
import { cleanup, fireEvent, render as renderBase, screen } from '@testing-library/react';
import * as m from 'motion/react-m';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildContextBudgetErrorViewModel,
  getContextBudgetFailureFromErrorBody,
} from '@/features/Conversation/utils/contextBudgetView';

import ContextBudgetErrorCard from './ContextBudgetErrorCard';

// Same motion provider the app installs in AppTheme; base-ui Button requires it.
const Wrapper = ({ children }: { children: ReactNode }) => (
  <MotionProvider motion={m}>{children}</MotionProvider>
);
const render = (ui: ReactElement) => renderBase(ui, { wrapper: Wrapper });

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key,
  }),
}));

const SECRET = {
  attachmentName: 'payroll-2026-Q3-CONFIDENTIAL.xlsx',
  fileUrl: 'https://files.internal.example/secret/payroll.xlsx?token=sk-live-9f8e7d',
  rawMessage: 'My password is hunter2-super-secret',
  toolResult: '{"apiKey":"AKIA-SECRET-TOOL-RESULT"}',
};

const body = (code: ContextBudgetFailCode) => ({
  attachments: [{ name: SECRET.attachmentName, url: SECRET.fileUrl }],
  contextBudget: {
    decision: {
      actions: ['truncate_tool_results', 'detach_attachments', 'switch_model', 'fork_topic'],
      code,
      kind: 'fail',
      offending: [
        { content: SECRET.rawMessage, estimatedTokens: 120_000, source: 'attachment' },
        { estimatedTokens: 30_000, source: 'tool-result' },
      ],
    },
    trace: {
      attempt: 1,
      effectiveWindowSource: 'assumed',
      effectiveWindowTokens: 32_000,
      estimatedPromptTokens: 150_000,
      modelId: 'gpt-4o-mini',
      providerId: 'aihub',
      rawPrompt: SECRET.rawMessage,
      warnings: ['WINDOW_UNKNOWN'],
    },
  },
  message: SECRET.rawMessage,
  toolResult: SECRET.toolResult,
});

const viewModelFor = (code: ContextBudgetFailCode) =>
  buildContextBudgetErrorViewModel(getContextBudgetFailureFromErrorBody(body(code))!);

const button = (name: string) => screen.getByRole('button', { name });

describe('<ContextBudgetErrorCard />', () => {
  afterEach(() => cleanup());

  it('renders a terminal error with alert role and a labelled heading', () => {
    render(<ContextBudgetErrorCard viewModel={viewModelFor('TAIL_TOO_LARGE')} onAction={vi.fn()} />);

    const alert = screen.getByRole('alert');
    const heading = screen.getByRole('heading', {
      level: 4,
      name: 'contextBudget.title.TAIL_TOO_LARGE',
    });
    expect(alert).toHaveAttribute('aria-labelledby', heading.id);
    expect(screen.getByText('contextBudget.desc.TAIL_TOO_LARGE')).toBeInTheDocument();
  });

  it('TAIL_TOO_LARGE shows the largest source and the four manual suggestions', () => {
    render(<ContextBudgetErrorCard viewModel={viewModelFor('TAIL_TOO_LARGE')} onAction={vi.fn()} />);

    expect(
      screen.getByText(
        'contextBudget.largestSource {"source":"contextBudget.source.attachment","tokens":"120,000"}',
      ),
    ).toBeInTheDocument();
    const hints = screen.getByRole('list', { name: 'contextBudget.hintsLabel' });
    expect(hints.querySelectorAll('li')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'contextBudget.action.retryCompression' })).toBeNull();
    expect(button('contextBudget.action.detachAttachments')).toBeInTheDocument();
    expect(button('contextBudget.action.switchModel')).toBeInTheDocument();
    expect(button('contextBudget.action.forkTopic')).toBeInTheDocument();
  });

  it('NO_CANDIDATES disables re-compress, explains why, and ignores clicks on it', () => {
    const onAction = vi.fn();
    render(<ContextBudgetErrorCard viewModel={viewModelFor('NO_CANDIDATES')} onAction={onAction} />);

    const retry = button('contextBudget.action.retryCompression');
    // Native `disabled` carries the a11y semantics; the reason is linked via aria-describedby.
    expect(retry).toBeDisabled();
    const reason = screen.getByText('contextBudget.action.retryCompressionUnavailable');
    expect(retry).toHaveAttribute('aria-describedby', reason.id);

    fireEvent.click(retry);
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(button('contextBudget.action.truncateToolResults'));
    expect(onAction).toHaveBeenCalledWith('truncate_tool_results');
  });

  it('SUMMARY_FAILED offers retry / compression model and states originals were kept', () => {
    const onAction = vi.fn();
    render(<ContextBudgetErrorCard viewModel={viewModelFor('SUMMARY_FAILED')} onAction={onAction} />);

    expect(screen.getByText('contextBudget.note.originalsPreserved')).toBeInTheDocument();
    fireEvent.click(button('contextBudget.action.retryCompression'));
    fireEvent.click(button('contextBudget.action.switchCompressionModel'));
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'retry_compression',
      'switch_compression_model',
    ]);
  });

  it('RETRY_EXHAUSTED has no re-compress button and explains that auto retry stopped', () => {
    render(<ContextBudgetErrorCard viewModel={viewModelFor('RETRY_EXHAUSTED')} onAction={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'contextBudget.action.retryCompression' })).toBeNull();
    expect(screen.getByText('contextBudget.note.autoRetryStopped')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'contextBudget.actionsLabel' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(button('contextBudget.action.switchModel')).toBeInTheDocument();
    expect(button('contextBudget.action.forkTopic')).toBeInTheDocument();
  });

  it('keeps action buttons keyboard focusable and marks the running one as loading', () => {
    const { rerender } = render(
      <ContextBudgetErrorCard viewModel={viewModelFor('SUMMARY_FAILED')} onAction={vi.fn()} />,
    );

    const retry = button('contextBudget.action.retryCompression');
    retry.focus();
    expect(document.activeElement).toBe(retry);
    expect(retry).not.toBeDisabled();

    rerender(
      <ContextBudgetErrorCard
        loadingAction={'retry_compression'}
        viewModel={viewModelFor('SUMMARY_FAILED')}
        onAction={vi.fn()}
      />,
    );
    // The running action is disabled while loading; the others stay actionable.
    expect(button('contextBudget.action.retryCompression')).toBeDisabled();
    expect(button('contextBudget.action.switchCompressionModel')).not.toBeDisabled();
  });

  it('exposes diagnostics behind an accessible toggle with readable window source and attempt', () => {
    render(<ContextBudgetErrorCard viewModel={viewModelFor('NO_CANDIDATES')} onAction={vi.fn()} />);

    const toggle = button('contextBudget.diagnostics.toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel).toBeInTheDocument();
    expect(panel.textContent).toContain('aihub / gpt-4o-mini');
    expect(panel.textContent).toContain(
      'contextBudget.diagnostics.windowValue {"source":"contextBudget.diagnostics.windowSource.assumed","tokens":"32,000"}',
    );
    expect(panel.textContent).toContain('contextBudget.diagnostics.windowUnknown');
    expect(panel.textContent).toContain('contextBudget.diagnostics.tokens {"tokens":"150,000"}');
    expect(panel.textContent).toContain(
      'contextBudget.diagnostics.attemptValue {"attempt":1,"limit":1}',
    );
    expect(panel.textContent).toContain(
      'contextBudget.diagnostics.sourceShare {"share":"80%","source":"contextBudget.source.attachment","tokens":"120,000"}',
    );
    expect(panel.textContent).toContain(
      'contextBudget.diagnostics.sourceShare {"share":"20%","source":"contextBudget.source.toolResult","tokens":"30,000"}',
    );
  });

  it.each(['TAIL_TOO_LARGE', 'NO_CANDIDATES', 'SUMMARY_FAILED', 'RETRY_EXHAUSTED'] as const)(
    'DOM for %s never contains raw messages, attachments, urls or tool results (diagnostics open)',
    (code) => {
      const { container } = render(
        <ContextBudgetErrorCard viewModel={viewModelFor(code)} onAction={vi.fn()} />,
      );
      fireEvent.click(button('contextBudget.diagnostics.toggle'));

      for (const secret of Object.values(SECRET)) {
        expect(container.innerHTML).not.toContain(secret);
      }
      expect(container.innerHTML).not.toContain('hunter2');
      expect(container.innerHTML).not.toContain('sk-live');
      expect(container.innerHTML).not.toContain('AKIA');
      expect(container.innerHTML).not.toContain('payroll');
    },
  );
});
