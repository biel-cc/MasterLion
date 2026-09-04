import { CHAT_GROUP_SESSION_ID_PREFIX } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { agentDocumentService } from '@/services/agentDocument';
import { type LobeAgentConfig } from '@/types/agent';
import { withSWR } from '~test-utils';

import { useAgentStore } from '../../store';

// Mock zustand/traditional for store testing
vi.mock('zustand/traditional');

// Mock agentService
vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    createAgent: vi.fn(),
    getAgentConfigById: vi.fn(),
    getSessionConfig: vi.fn(),
    queryAgents: vi.fn(),
    updateAgentConfig: vi.fn(),
    updateAgentMeta: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    listDocuments: vi.fn(),
  },
  agentDocumentSWRKeys: {
    documents: (agentId: string) => ['agent:documents', agentId] as const,
    documentsList: (agentId: string) => ['agent:documentsList', agentId] as const,
  },
  resolveAgentDocumentsContext: vi.fn(),
}));

// Mock sessionStore
vi.mock('@/store/session', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      refreshSessions: vi.fn(),
    })),
  },
}));

// Mock SWR mutate
vi.mock('swr', async (importOriginal) => {
  const modules = await importOriginal();
  return {
    ...(modules as any),
    mutate: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({
    activeAgentId: undefined,
    agentMap: {},
    builtinAgentIdMap: {},
    availableAgents: undefined,
    updateAgentConfigSignal: undefined,
    agentDocumentsMap: {},
    updateAgentMetaSignal: undefined,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentSlice Actions', () => {
  describe('createAgent', () => {
    it('should invalidate cached available agents after creating an agent', async () => {
      vi.mocked(agentService.createAgent).mockResolvedValue({ agentId: 'agent-2' });
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'stale',
              id: 'agent-1',
              title: 'Stale Agent',
            },
          ],
        });
      });

      await act(async () => {
        await result.current.createAgent({ config: { title: 'New Agent' } });
      });

      expect(result.current.availableAgents).toBeUndefined();
    });
  });

  describe('useFetchAgentDocuments', () => {
    it('should fetch agent documents via listDocuments', async () => {
      const docs = [
        {
          documentId: 'doc-1',
          filename: 'setup.md',
          id: 'doc-1',
          title: 'Setup',
        },
      ];
      vi.mocked(agentDocumentService.listDocuments).mockResolvedValue(docs as any);

      const store = renderHook(() => useAgentStore(), { wrapper: withSWR });

      const { result } = renderHook(() => store.result.current.useFetchAgentDocuments('agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(docs);
      });
      expect(agentDocumentService.listDocuments).toHaveBeenCalledWith({ agentId: 'agent-1' });
    });
  });

  describe('useFetchAvailableAgents', () => {
    it('should sync fetched available agents into store cache', async () => {
      vi.mocked(agentService.queryAgents).mockResolvedValue([
        {
          avatar: null,
          backgroundColor: null,
          description: 'Helps with setup',
          id: 'agent-1',
          title: 'Setup',
        },
      ]);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      renderHook(() => result.current.useFetchAvailableAgents(true), { wrapper: withSWR });

      await waitFor(() => {
        expect(result.current.availableAgents).toEqual([
          {
            avatar: null,
            backgroundColor: null,
            description: 'Helps with setup',
            id: 'agent-1',
            title: 'Setup',
          },
        ]);
      });
      expect(agentService.queryAgents).toHaveBeenCalledWith({ limit: 12 });
    });
  });

  describe('useFetchAgentConfig', () => {
    it('adopts the fetched agent as active when none is active yet', async () => {
      vi.mocked(agentService.getAgentConfigById).mockResolvedValue({
        id: 'agent-1',
        title: 'Setup',
      } as any);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      renderHook(() => result.current.useFetchAgentConfig(true, 'agent-1'), { wrapper: withSWR });

      await waitFor(() => {
        expect(result.current.agentMap['agent-1']).toMatchObject({ id: 'agent-1', title: 'Setup' });
      });
      expect(result.current.activeAgentId).toBe('agent-1');
    });

    it('does not hijack activeAgentId when another agent is already active', async () => {
      // The active agent is owned by the route-level sync; simulate the routed agent.
      useAgentStore.setState({ activeAgentId: 'routed-agent' });

      vi.mocked(agentService.getAgentConfigById).mockResolvedValue({
        id: 'inbox-agent',
        title: 'Masterino',
      } as any);

      const { result } = renderHook(() => useAgentStore(), { wrapper: withSWR });

      // A background / secondary config fetch for a different agent (e.g. the
      // inbox config requested by the home input or another open tab).
      renderHook(() => result.current.useFetchAgentConfig(true, 'inbox-agent'), {
        wrapper: withSWR,
      });

      await waitFor(() => {
        expect(result.current.agentMap['inbox-agent']).toMatchObject({ id: 'inbox-agent' });
      });
      // The background fetch only populates agentMap; it must not steal the active agent.
      expect(result.current.activeAgentId).toBe('routed-agent');
    });
  });

  describe('invalidateAvailableAgents', () => {
    it('should clear cached available agents', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'stale',
              id: 'agent-1',
              title: 'Stale Agent',
            },
          ],
        });
      });

      act(() => {
        result.current.invalidateAvailableAgents();
      });

      expect(result.current.availableAgents).toBeUndefined();
    });
  });

  describe('internal_dispatchAgentMap', () => {
    it('should create new agent entry if not exists', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
    });

    it('should merge config into existing agent entry', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4', systemRole: 'test' });
      });

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4o' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        model: 'gpt-4o',
        systemRole: 'test',
      });
    });

    it('should deep merge nested chatConfig fields into existing agent entry', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', {
          chatConfig: { enableHistoryCount: true, historyCount: 10 },
        });
      });

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', {
          chatConfig: { enableReasoning: true },
        });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        chatConfig: {
          enableHistoryCount: true,
          enableReasoning: true,
          historyCount: 10,
        },
      });
    });

    it('should not update state if result is equal', () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      const prevAgentMap = result.current.agentMap;

      act(() => {
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
      });

      // Should be the same reference if no change
      expect(result.current.agentMap).toBe(prevAgentMap);
    });
  });

  describe('internal_createAbortController', () => {
    it('should create a new abort controller', () => {
      const { result } = renderHook(() => useAgentStore());

      let controller: AbortController;
      act(() => {
        controller = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      expect(controller!).toBeInstanceOf(AbortController);
      expect(result.current.updateAgentConfigSignal).toBe(controller!);
    });

    it('should abort previous controller when creating new one', () => {
      const { result } = renderHook(() => useAgentStore());

      let controller1: AbortController;
      let controller2: AbortController;

      act(() => {
        controller1 = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      const abortSpy = vi.spyOn(controller1!, 'abort');

      act(() => {
        controller2 = result.current.internal_createAbortController('updateAgentConfigSignal');
      });

      expect(abortSpy).toHaveBeenCalled();
      expect(result.current.updateAgentConfigSignal).toBe(controller2!);
    });
  });

  describe('updateAgentConfig', () => {
    it('should not call optimisticUpdateAgentConfig if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateAgentConfig');

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'gpt-4' });
      });

      expect(optimisticUpdateSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticUpdateAgentConfig with activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { model: 'gpt-4' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentConfig({ model: 'gpt-4' });
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith('agent-1', { model: 'gpt-4' });
    });
  });

  describe('updateAgentMeta', () => {
    it('should not call optimisticUpdateAgentMeta if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const optimisticUpdateSpy = vi.spyOn(result.current, 'optimisticUpdateAgentMeta');

      await act(async () => {
        await result.current.updateAgentMeta({ title: 'New Title' });
      });

      expect(optimisticUpdateSpy).not.toHaveBeenCalled();
    });

    it('should call optimisticUpdateAgentMeta with activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { title: 'New Title' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentMeta({ title: 'New Title' });
      });

      expect(agentService.updateAgentMeta).toHaveBeenCalledWith('agent-1', { title: 'New Title' });
    });

    it('should preserve explicit null when clearing avatar', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { avatar: null } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentMeta({ avatar: null });
      });

      expect(agentService.updateAgentMeta).toHaveBeenCalledWith('agent-1', { avatar: null });
    });
  });

  describe('updateAgentChatConfig', () => {
    it('should not call updateAgentConfig if no activeAgentId', async () => {
      const { result } = renderHook(() => useAgentStore());

      const updateConfigSpy = vi.spyOn(result.current, 'updateAgentConfig');

      await act(async () => {
        await result.current.updateAgentChatConfig({ historyCount: 10 });
      });

      expect(updateConfigSpy).not.toHaveBeenCalled();
    });

    it('should call updateAgentConfig with chatConfig wrapper', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { chatConfig: { historyCount: 10 } } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1' });
      });

      await act(async () => {
        await result.current.updateAgentChatConfig({ historyCount: 10 });
      });

      expect(agentService.updateAgentConfig).toHaveBeenCalledWith('agent-1', {
        chatConfig: { historyCount: 10 },
      });
    });
  });

  describe('optimisticUpdateAgentConfig', () => {
    it('should perform optimistic update and then use API result', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { model: 'gpt-4', provider: 'openai' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
      });

      // Should have the API returned data merged
      expect(result.current.agentMap['agent-1']).toEqual({
        model: 'gpt-4',
        provider: 'openai',
      });
    });

    it('does not let an older successful response overwrite a newer success', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveOlder!: (value: any) => void;
      let resolveNewer!: (value: any) => void;
      const olderResponse = new Promise((resolve) => {
        resolveOlder = resolve;
      });
      const newerResponse = new Promise((resolve) => {
        resolveNewer = resolve;
      });

      vi.mocked(agentService.updateAgentConfig)
        .mockReturnValueOnce(olderResponse as any)
        .mockReturnValueOnce(newerResponse as any);

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'original' } },
        });
      });

      let olderSave!: Promise<void>;
      let newerSave!: Promise<void>;
      act(() => {
        olderSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'older' });
        newerSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'newer' });
      });

      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));
      await act(async () => {
        resolveOlder({
          agent: { model: 'older', provider: 'older-provider' },
          success: true,
        });
        await olderSave;
      });
      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(2));
      await act(async () => {
        resolveNewer({
          agent: { model: 'newer', provider: 'newer-provider' },
          success: true,
        });
        await newerSave;
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        model: 'newer',
        provider: 'newer-provider',
      });
    });

    it('serializes persistence per agent so the latest intent is also the database winner', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveOlder!: (value: any) => void;
      let resolveNewer!: (value: any) => void;
      const olderResponse = new Promise((resolve) => {
        resolveOlder = resolve;
      });
      const newerResponse = new Promise((resolve) => {
        resolveNewer = resolve;
      });

      vi.mocked(agentService.updateAgentConfig)
        .mockReturnValueOnce(olderResponse as any)
        .mockReturnValueOnce(newerResponse as any);
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'original', title: 'original' } },
        });
      });

      let olderSave!: Promise<void>;
      let newerSave!: Promise<void>;
      act(() => {
        olderSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'older' });
        newerSave = result.current.optimisticUpdateAgentConfig('agent-1', { title: 'newer' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'older', title: 'newer' });
      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));

      await act(async () => {
        resolveOlder({
          agent: { model: 'older', title: 'original' },
          success: true,
        });
        await olderSave;
      });
      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(2));

      await act(async () => {
        resolveNewer({
          agent: { model: 'older', title: 'newer' },
          success: true,
        });
        await newerSave;
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'older', title: 'newer' });
      expect(vi.mocked(agentService.updateAgentConfig).mock.calls).toEqual([
        ['agent-1', { model: 'older' }],
        ['agent-1', { title: 'newer' }],
      ]);
    });

    // Note: refreshSessions is no longer called after optimistic update
    // as the implementation now uses API returned data directly

    it('replaces the listed paths so a removed map entry does not survive the deep merge', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { agencyConfig: { env: { KEEP: 'yes' } } } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { agencyConfig: { env: { KEEP: 'yes', REMOVED: 'old' } } } as any,
          },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig(
          'agent-1',
          { agencyConfig: { env: { KEEP: 'yes' } } } as any,
          undefined,
          { replacePaths: ['agencyConfig.env'] },
        );
      });

      expect((result.current.agentMap['agent-1'] as any).agencyConfig.env).toEqual({
        KEEP: 'yes',
      });
    });

    it('rejects and rolls the optimistic write back when the request fails', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        await expect(
          result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' }, undefined, {
            throwOnError: true,
          }),
        ).rejects.toThrow('offline');
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-3.5-turbo' });
      expect(result.current.saveStatus).toBe('idle');
      consoleError.mockRestore();
    });

    it('treats an unconfirmed response as a failure instead of a save', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({ success: false } as any);

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        await expect(
          result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' }, undefined, {
            throwOnError: true,
          }),
        ).rejects.toThrow('not confirmed');
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-3.5-turbo' });
      expect(result.current.saveStatus).toBe('idle');
      consoleError.mockRestore();
    });

    it('never reports "saved" for an unconfirmed response without throwOnError', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: undefined,
        success: true,
      } as any);

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1', agentMap: {} });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
      });

      expect(result.current.saveStatus).toBe('idle');
      expect(result.current.agentMap).not.toHaveProperty('agent-1');
      consoleError.mockRestore();
    });

    it('rolls back only the failed agent and preserves unrelated state', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { model: 'gpt-3.5-turbo' },
            'agent-2': { model: 'keep-me' },
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        useAgentStore.setState((state) => ({
          agentMap: {
            ...state.agentMap,
            'agent-2': { model: 'updated-elsewhere' },
          },
        }));
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-3.5-turbo' });
      expect(result.current.agentMap['agent-2']).toEqual({ model: 'updated-elsewhere' });
      consoleError.mockRestore();
    });

    it('rolls back only the paths it wrote, keeping a concurrent meta update', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': {
              chatConfig: { historyCount: 10 },
              model: 'gpt-3.5-turbo',
              title: 'Old Title',
            } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        // A meta save for the same agent lands while the config save is in flight.
        result.current.internal_dispatchAgentMap('agent-1', { title: 'New Title' } as any);
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        chatConfig: { historyCount: 10 },
        // rolled back
        model: 'gpt-3.5-turbo',
        // preserved
        title: 'New Title',
      });
      consoleError.mockRestore();
    });

    it('rolls back a nested leaf without discarding its siblings', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { chatConfig: { historyCount: 10 } } as any },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', {
          chatConfig: { historyCount: 99 },
        } as any);
        result.current.internal_dispatchAgentMap('agent-1', {
          chatConfig: { enableReasoning: true },
        } as any);
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        chatConfig: { enableReasoning: true, historyCount: 10 },
      });
      consoleError.mockRestore();
    });

    it('deletes keys the failed update created instead of leaving them undefined', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-4' } as any },
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig('agent-1', {
          agencyConfig: { env: { ADDED: 'x' } },
        } as any);
      });

      // No `agencyConfig: { env: {} }` husk left behind.
      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
      expect(Object.keys(result.current.agentMap['agent-1'] as object)).toEqual(['model']);
      consoleError.mockRestore();
    });

    it('restores a replaced subtree wholesale, including entries it removed', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': {
              agencyConfig: { env: { KEEP: 'yes', REMOVED: 'old' } },
              model: 'gpt-4',
            } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig(
          'agent-1',
          { agencyConfig: { env: { KEEP: 'yes' } } } as any,
          undefined,
          { replacePaths: ['agencyConfig.env'] },
        );
        result.current.internal_dispatchAgentMap('agent-1', { title: 'Renamed' } as any);
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        // the deleted entry is restored, not merged away
        agencyConfig: { env: { KEEP: 'yes', REMOVED: 'old' } },
        model: 'gpt-4',
        title: 'Renamed',
      });
      consoleError.mockRestore();
    });

    it('leaves a scalar path alone when a later write already replaced its value', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        // A second save for the same field lands first and wins.
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4o' });
        await pending;
      });

      // The stale failure must not resurrect a value older than the winner's.
      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4o' });
      consoleError.mockRestore();
    });

    it('leaves a replaced subtree alone when a later replace already rewrote it', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { agencyConfig: { env: { KEEP: 'yes', REMOVED: 'old' } } } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig(
          'agent-1',
          { agencyConfig: { env: { KEEP: 'yes' } } } as any,
          undefined,
          { replacePaths: ['agencyConfig.env'] },
        );
        result.current.internal_dispatchAgentMap(
          'agent-1',
          { agencyConfig: { env: { ADDED: 'new', KEEP: 'yes' } } } as any,
          { replacePaths: ['agencyConfig.env'] },
        );
        await pending;
      });

      // Neither the loser's optimistic subtree nor the pre-update one comes back.
      expect((result.current.agentMap['agent-1'] as any).agencyConfig.env).toEqual({
        ADDED: 'new',
        KEEP: 'yes',
      });
      consoleError.mockRestore();
    });

    it('rolls back the paths it still owns while skipping the ones a later write took', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { chatConfig: { historyCount: 10 }, model: 'gpt-3.5-turbo' } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', {
          chatConfig: { historyCount: 99 },
          model: 'gpt-4',
        } as any);
        // Overlaps on `model` only; `chatConfig.historyCount` is still ours.
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4o' });
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        // rolled back
        chatConfig: { historyCount: 10 },
        // left to the winner
        model: 'gpt-4o',
      });
      consoleError.mockRestore();
    });

    it('leaves a path alone when a later write re-set the value this one wrote', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        // A second save lands on the same field with the same value. Nothing in the
        // map changes, so it is invisible to a value comparison — but it owns
        // `model` now, and its write is the one the server confirmed.
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
      consoleError.mockRestore();
    });

    it('leaves a path alone when later writes cycled it back to the value it wrote', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        // A → B → A: the value is back to the one this update wrote, but two other
        // writes have owned the path since.
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4o' });
        result.current.internal_dispatchAgentMap('agent-1', { model: 'gpt-4' });
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
      consoleError.mockRestore();
    });

    it('leaves a replaced subtree alone when a later write landed on a leaf inside it', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { agencyConfig: { env: { KEEP: 'yes', REMOVED: 'old' } } } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig(
          'agent-1',
          { agencyConfig: { env: { KEEP: 'yes' } } } as any,
          undefined,
          { replacePaths: ['agencyConfig.env'] },
        );
        // A leaf write inside the replaced subtree: the subtree is no longer this
        // update's to undo as one unit, even though its own value is untouched.
        result.current.internal_dispatchAgentMap('agent-1', {
          agencyConfig: { env: { KEEP: 'yes' } },
        } as any);
        await pending;
      });

      // Restoring the subtree would resurrect `REMOVED`, which the leaf writer saw gone.
      expect((result.current.agentMap['agent-1'] as any).agencyConfig.env).toEqual({ KEEP: 'yes' });
      consoleError.mockRestore();
    });

    it('leaves a leaf alone when a later replace rewrote the subtree around it', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: {
            'agent-1': { agencyConfig: { env: { FOO: 'old', KEEP: 'yes' } } } as any,
          },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', {
          agencyConfig: { env: { FOO: 'new' } },
        } as any);
        // A wholesale replace of the enclosing subtree, which happens to keep this
        // update's leaf value while dropping `KEEP`.
        result.current.internal_dispatchAgentMap(
          'agent-1',
          { agencyConfig: { env: { FOO: 'new' } } } as any,
          { replacePaths: ['agencyConfig.env'] },
        );
        await pending;
      });

      // Undoing the leaf would put `FOO: 'old'` back inside the winner's subtree.
      expect((result.current.agentMap['agent-1'] as any).agencyConfig.env).toEqual({ FOO: 'new' });
      consoleError.mockRestore();
    });

    it('releases its ownership when the agent is deleted, even if the id comes back', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        // The agent is deleted while the save is in flight. The next dispatch — for
        // any agent — drops the bookkeeping it left behind, so it neither outlives
        // the agent nor follows the id into whatever is created under it next.
        useAgentStore.setState({ agentMap: {} });
        result.current.internal_dispatchAgentMap('agent-2', { model: 'unrelated' });
        useAgentStore.setState((state) => ({
          agentMap: { ...state.agentMap, 'agent-1': { model: 'gpt-4' } },
        }));
        await pending;
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-4' });
      consoleError.mockRestore();
    });

    it('keeps its write bookkeeping out of the stored agent config', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentConfig).mockResolvedValue({
        agent: { agencyConfig: { env: { KEEP: 'yes' } }, id: 'agent-1', model: 'gpt-4' },
        success: true,
      } as any);

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1', agentMap: {} });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentConfig('agent-1', {
          agencyConfig: { env: { KEEP: 'yes' } },
          model: 'gpt-4',
        } as any);
      });

      // Ownership is tracked outside the map: what is stored — and later persisted
      // and sent to the server — is exactly the config, at every level.
      expect(result.current.agentMap['agent-1']).toEqual({
        agencyConfig: { env: { KEEP: 'yes' } },
        id: 'agent-1',
        model: 'gpt-4',
      });
    });

    it('keeps a concurrently created entry when the failed update created the agent', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(new Error('offline'));

      act(() => {
        useAgentStore.setState({ activeAgentId: 'agent-1', agentMap: {} });
      });

      await act(async () => {
        const pending = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' });
        result.current.internal_dispatchAgentMap('agent-1', { title: 'New Title' } as any);
        await pending;
      });

      // The entry survives because another write owns `title`, but the failed
      // config write leaves nothing behind.
      expect(result.current.agentMap['agent-1']).toEqual({ title: 'New Title' });
      consoleError.mockRestore();
    });

    it('rolls an aborted optimistic write back when no replacement exists', async () => {
      const { result } = renderHook(() => useAgentStore());
      const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });

      vi.mocked(agentService.updateAgentConfig).mockRejectedValue(aborted);

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'gpt-3.5-turbo' } },
        });
      });

      await act(async () => {
        await expect(
          result.current.optimisticUpdateAgentConfig('agent-1', { model: 'gpt-4' }, undefined, {
            throwOnError: true,
          }),
        ).rejects.toBe(aborted);
      });

      expect(result.current.agentMap['agent-1']).toEqual({ model: 'gpt-3.5-turbo' });
    });

    it('continues the serial queue after an older abort and unwinds a newer failure', async () => {
      const { result } = renderHook(() => useAgentStore());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
      let rejectOlder!: (reason: unknown) => void;
      let rejectNewer!: (reason: unknown) => void;
      const olderResponse = new Promise((_resolve, reject) => {
        rejectOlder = reject;
      });
      const newerResponse = new Promise((_resolve, reject) => {
        rejectNewer = reject;
      });

      vi.mocked(agentService.updateAgentConfig)
        .mockReturnValueOnce(olderResponse as any)
        .mockReturnValueOnce(newerResponse as any);

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'original' } },
        });
      });

      let olderSave!: Promise<void>;
      let newerSave!: Promise<void>;
      act(() => {
        olderSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'older' });
        newerSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'newer' });
      });

      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));
      await act(async () => {
        rejectOlder(aborted);
        await olderSave;
      });
      expect(result.current.agentMap['agent-1']).toEqual({ model: 'newer' });

      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(2));
      await act(async () => {
        rejectNewer(new Error('newer failed'));
        await newerSave;
      });
      expect(result.current.agentMap['agent-1']).toEqual({ model: 'original' });
      consoleError.mockRestore();
    });
  });

  describe('updateAgentConfig error reporting', () => {
    it('rejects rather than silently doing nothing when there is no active agent', async () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({ activeAgentId: undefined });
      });

      await expect(
        result.current.updateAgentConfig({ model: 'gpt-4' }, { throwOnError: true }),
      ).rejects.toThrow('No active agent');
      expect(agentService.updateAgentConfig).not.toHaveBeenCalled();
    });

    it('stays a silent no-op for callers that did not opt into error reporting', async () => {
      const { result } = renderHook(() => useAgentStore());

      act(() => {
        useAgentStore.setState({ activeAgentId: undefined });
      });

      await expect(result.current.updateAgentConfig({ model: 'gpt-4' })).resolves.toBeUndefined();
    });
  });

  describe('optimisticUpdateAgentMeta', () => {
    it('should perform optimistic update and then use API result', async () => {
      const { result } = renderHook(() => useAgentStore());

      vi.mocked(agentService.updateAgentMeta).mockResolvedValue({
        agent: { title: 'New Title', description: 'New Desc' } as any,
        success: true,
      });

      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { title: 'Old Title' } as any },
          availableAgents: [
            {
              avatar: null,
              backgroundColor: null,
              description: 'Old Desc',
              id: 'agent-1',
              title: 'Old Title',
            },
          ],
        });
      });

      await act(async () => {
        await result.current.optimisticUpdateAgentMeta('agent-1', { title: 'New Title' });
      });

      expect(result.current.agentMap['agent-1']).toEqual({
        description: 'New Desc',
        title: 'New Title',
      });
      expect(result.current.availableAgents).toBeUndefined();
    });

    it('shares the per-agent persistence queue with config writes', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveConfig!: (value: any) => void;
      let resolveMeta!: (value: any) => void;
      vi.mocked(agentService.updateAgentConfig).mockReturnValue(
        new Promise((resolve) => {
          resolveConfig = resolve;
        }) as any,
      );
      vi.mocked(agentService.updateAgentMeta).mockReturnValue(
        new Promise((resolve) => {
          resolveMeta = resolve;
        }) as any,
      );
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'original', title: 'Original Title' } },
        });
      });

      let configSave!: Promise<void>;
      let metaSave!: Promise<void>;
      act(() => {
        configSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'updated' });
        metaSave = result.current.optimisticUpdateAgentMeta('agent-1', { title: 'Updated Title' });
      });

      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));
      expect(agentService.updateAgentMeta).not.toHaveBeenCalled();
      expect(result.current.agentMap['agent-1']).toMatchObject({
        model: 'updated',
        title: 'Updated Title',
      });

      await act(async () => {
        resolveConfig({
          agent: { model: 'updated', title: 'Original Title' },
          success: true,
        });
        await configSave;
      });
      await vi.waitFor(() => expect(agentService.updateAgentMeta).toHaveBeenCalledTimes(1));

      await act(async () => {
        resolveMeta({
          agent: { model: 'updated', title: 'Updated Title' },
          success: true,
        });
        await metaSave;
      });

      expect(result.current.agentMap['agent-1']).toMatchObject({
        model: 'updated',
        title: 'Updated Title',
      });
    });

    it('does not let a full meta response overwrite a pending config field', async () => {
      const { result } = renderHook(() => useAgentStore());
      let resolveMeta!: (value: any) => void;
      let resolveConfig!: (value: any) => void;
      vi.mocked(agentService.updateAgentMeta).mockReturnValue(
        new Promise((resolve) => {
          resolveMeta = resolve;
        }) as any,
      );
      vi.mocked(agentService.updateAgentConfig).mockReturnValue(
        new Promise((resolve) => {
          resolveConfig = resolve;
        }) as any,
      );
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'agent-1',
          agentMap: { 'agent-1': { model: 'original', title: 'Original Title' } },
        });
      });

      let metaSave!: Promise<void>;
      let configSave!: Promise<void>;
      act(() => {
        metaSave = result.current.optimisticUpdateAgentMeta('agent-1', {
          title: 'Updated Title',
        });
        configSave = result.current.optimisticUpdateAgentConfig('agent-1', { model: 'updated' });
      });

      await vi.waitFor(() => expect(agentService.updateAgentMeta).toHaveBeenCalledTimes(1));
      await act(async () => {
        resolveMeta({
          agent: { model: 'original', title: 'Updated Title' },
          success: true,
        });
        await metaSave;
      });
      expect(result.current.agentMap['agent-1']).toMatchObject({
        model: 'updated',
        title: 'Updated Title',
      });

      await vi.waitFor(() => expect(agentService.updateAgentConfig).toHaveBeenCalledTimes(1));
      await act(async () => {
        resolveConfig({
          agent: { model: 'updated', title: 'Updated Title' },
          success: true,
        });
        await configSave;
      });
    });

    // Note: refreshSessions is no longer called after optimistic update
    // as the implementation now uses API returned data directly
  });

  describe('useFetchAgentConfig', () => {
    it('should not fetch when isLogin is false', async () => {
      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(false, 'agent-1'), {
        wrapper: withSWR,
      });

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when isLogin is undefined', async () => {
      const { result } = renderHook(
        () => useAgentStore().useFetchAgentConfig(undefined, 'agent-1'),
        { wrapper: withSWR },
      );

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when agentId is a chat-group session id', async () => {
      const { result } = renderHook(
        () =>
          useAgentStore().useFetchAgentConfig(true, `${CHAT_GROUP_SESSION_ID_PREFIX}group-chat`),
        { wrapper: withSWR },
      );

      expect(agentService.getAgentConfigById).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch agent config when logged in with valid agentId', async () => {
      const mockAgentConfig = {
        id: 'agent-1',
        model: 'gpt-4',
        systemRole: 'You are a helpful assistant',
      } as LobeAgentConfig;

      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
      expect(useAgentStore.getState().activeAgentId).toBe('agent-1');
      expect(useAgentStore.getState().agentMap['agent-1']).toBeDefined();
    });

    it('should record fetch error in agentConfigErrorMap and clear it on retry', async () => {
      const error = Object.assign(new Error('boom'), { meta: { shouldRetry: false } });
      vi.mocked(agentService.getAgentConfigById).mockRejectedValueOnce(error);

      renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-err'), {
        wrapper: withSWR,
      });

      await waitFor(() =>
        expect(useAgentStore.getState().agentConfigErrorMap['agent-err']).toBe('boom'),
      );

      await act(async () => {
        await useAgentStore.getState().retryAgentConfigFetch('agent-err');
      });

      expect(useAgentStore.getState().agentConfigErrorMap['agent-err']).toBeUndefined();
    });

    it('should clear a stale fetch error once data arrives', async () => {
      useAgentStore.setState({ agentConfigErrorMap: { 'agent-1': 'boom' } });

      const mockAgentConfig = { id: 'agent-1', model: 'gpt-4' } as LobeAgentConfig;
      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useFetchAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(useAgentStore.getState().agentConfigErrorMap['agent-1']).toBeUndefined();
    });
  });

  describe('useHydrateAgentConfig', () => {
    it('should hydrate agent config without changing activeAgentId', async () => {
      const mockAgentConfig = {
        id: 'agent-1',
        model: 'gpt-4',
        systemRole: 'You are a helpful assistant',
      } as LobeAgentConfig;

      useAgentStore.setState({ activeAgentId: 'agent-current' });
      vi.mocked(agentService.getAgentConfigById).mockResolvedValueOnce(mockAgentConfig as any);

      const { result } = renderHook(() => useAgentStore().useHydrateAgentConfig(true, 'agent-1'), {
        wrapper: withSWR,
      });

      await waitFor(() => expect(result.current.data).toEqual(mockAgentConfig));

      expect(agentService.getAgentConfigById).toHaveBeenCalledWith('agent-1');
      expect(useAgentStore.getState().activeAgentId).toBe('agent-current');
      expect(useAgentStore.getState().agentMap['agent-1']).toBeDefined();
    });
  });
});
