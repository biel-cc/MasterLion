import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotebookBody from './Body';

const { fetchState, refresh } = vi.hoisted(() => ({
  fetchState: {
    documents: [] as Array<{ id: string; title: string }>,
    error: undefined as Error | undefined,
    isLoading: false,
    isValidating: false,
  },
  refresh: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useFetchNotebookDocuments', () => ({
  useFetchNotebookDocuments: () => ({ ...fetchState, refresh, topicId: 'topic-1' }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { activeTopicId: string }) => unknown) =>
    selector({ activeTopicId: 'topic-1' }),
}));

vi.mock('./DocumentItem', () => ({
  default: ({ document }: { document: { title: string } }) => <div>{document.title}</div>,
}));

describe('NotebookBody failure recovery', () => {
  beforeEach(() => {
    fetchState.documents = [];
    fetchState.error = undefined;
    fetchState.isLoading = false;
    fetchState.isValidating = false;
    refresh.mockReset();
  });

  it('shows a recoverable error instead of an empty notebook after retries stop', () => {
    fetchState.error = new Error('temporary failure');

    render(<NotebookBody />);

    expect(screen.getByText('notebook.loadError')).toBeInTheDocument();
    expect(screen.queryByText('notebook.empty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common:retry' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps stale summaries visible when a background refresh fails', () => {
    fetchState.documents = [{ id: 'doc-1', title: 'Existing report' }];
    fetchState.error = new Error('temporary failure');

    render(<NotebookBody />);

    expect(screen.getByText('Existing report')).toBeInTheDocument();
    expect(screen.getByText('notebook.loadError')).toBeInTheDocument();
  });
});
