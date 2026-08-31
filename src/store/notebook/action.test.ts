import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotebookActionImpl } from './action';

const { listDocumentSummaries, useClientDataSWR } = vi.hoisted(() => ({
  listDocumentSummaries: vi.fn(),
  useClientDataSWR: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR,
}));

vi.mock('@/services/notebook', () => ({
  notebookService: {
    listDocumentSummaries,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: vi.fn(() => ({})) },
}));

describe('NotebookActionImpl.useFetchDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useClientDataSWR.mockReturnValue({ data: [] });
  });

  it('uses the bounded summary interface and local anti-storm SWR policy', async () => {
    const documents = [{ id: 'doc-1', title: 'Summary' }];
    listDocumentSummaries.mockResolvedValue({ data: documents, total: 1 });
    const action = new NotebookActionImpl(vi.fn(), () => ({ notebookMap: {} }) as never);

    action.useFetchDocuments('topic-1');

    const [key, fetcher, config] = useClientDataSWR.mock.calls[0];
    expect(key).toEqual(['notebook:documents', 'topic-1']);
    await expect(fetcher()).resolves.toEqual(documents);
    expect(listDocumentSummaries).toHaveBeenCalledWith('topic-1');
    expect(config).toMatchObject({
      dedupingInterval: 5000,
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    });
    expect(config.shouldRetryOnError).toEqual(expect.any(Function));
    expect(config.onErrorRetry).toEqual(expect.any(Function));
  });
});
