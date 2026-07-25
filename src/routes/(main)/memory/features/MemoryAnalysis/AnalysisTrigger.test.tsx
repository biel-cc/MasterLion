import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  memoryEnabled: false,
  refresh: vi.fn(),
  requestFromChatTopics: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ disabled, onClick }: { disabled?: boolean; onClick?: () => void }) => (
    <button aria-label="memory-analysis-icon" disabled={disabled} onClick={onClick} />
  ),
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children, title }: { children: ReactNode; title?: string }) => (
    <span title={title}>{children}</span>
  ),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: vi.fn(),
        success: mocks.success,
        warning: mocks.warning,
      },
    }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'analysis.action.button': 'Request memory analysis',
        'analysis.action.enableFirst':
          'Enable Memory in personal settings before requesting analysis.',
        'analysis.toast.started': 'Memory analysis started.',
      })[key] ?? key,
  }),
}));

vi.mock('@/routes/(main)/memory/features/MemoryAnalysis/useTask', () => ({
  useMemoryAnalysisAsyncTask: () => ({
    isValidating: false,
    refresh: mocks.refresh,
  }),
}));

vi.mock('@/services/userMemory/extraction', () => ({
  memoryExtractionService: {
    requestFromChatTopics: mocks.requestFromChatTopics,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: () => mocks.memoryEnabled,
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    memoryEnabled: vi.fn(),
  },
}));

vi.mock('./DateRangeModal', () => ({
  default: ({ onSubmit, open }: { onSubmit: () => void; open: boolean }) =>
    open ? <button onClick={onSubmit}>Submit analysis</button> : null,
}));

const { default: AnalysisTrigger } = await import('./AnalysisTrigger');

describe('AnalysisTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memoryEnabled = false;
    mocks.requestFromChatTopics.mockResolvedValue({ deduped: false });
  });

  it('disables manual extraction until the user enables Memory', () => {
    render(<AnalysisTrigger footerNote="" range={[null, null]} onRangeChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Request memory analysis' })).toBeDisabled();
    expect(
      screen.getByTitle('Enable Memory in personal settings before requesting analysis.'),
    ).toBeInTheDocument();
  });

  it('submits extraction after explicit user consent', async () => {
    mocks.memoryEnabled = true;
    render(<AnalysisTrigger footerNote="" range={[null, null]} onRangeChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request memory analysis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit analysis' }));

    await waitFor(() => expect(mocks.requestFromChatTopics).toHaveBeenCalledWith({}));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledWith('Memory analysis started.');
  });
});
