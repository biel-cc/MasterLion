import { isDesktop } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import { isChatGroupSessionId } from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import { get as getAtPath, set as setAtPath } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import type { SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { agentConfigKeys } from '@/libs/swr/keys';
import type { AvailableAgentItem, CreateAgentParams, CreateAgentResult } from '@/services/agent';
import { agentService, AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT } from '@/services/agent';
import {
  type AgentDocumentListItem,
  agentDocumentService,
  agentDocumentSWRKeys,
  resolveAgentDocumentsContext,
} from '@/services/agentDocument';
import type { StoreSetter } from '@/store/types';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import type {
  AgentItem,
  LobeAgentChatConfig,
  LobeAgentConfig,
  RuntimeEnvConfig,
} from '@/types/agent';
import { merge } from '@/utils/merge';

import type { AgentStore } from '../../store';
import { setLocalAgentWorkingDirectory } from '../../utils/localAgentWorkingDirectoryStorage';
import type { AgentSliceState, LoadingState, SaveStatus } from './initialState';
import { AgentWriteLedger } from './writeLedger';

type AgentMetaUpdate = Partial<
  Pick<
    AgentItem,
    'avatar' | 'backgroundColor' | 'description' | 'marketIdentifier' | 'tags' | 'title'
  >
>;

export interface AgentConfigUpdateOptions {
  /**
   * Dot paths whose value replaces the stored one instead of being deep-merged.
   * Deep merge cannot express a removal, so a caller that deletes a map entry
   * (e.g. `agencyConfig.env`) must say so or the UI keeps showing the old entry.
   */
  replacePaths?: string[];
  /**
   * Rethrow persistence failures (and roll the optimistic write back) so the caller
   * can report the failure instead of rendering a success it never got.
   */
  throwOnError?: boolean;
}

/**
 * Agent Slice Actions
 * Handles agent CRUD operations (config/meta updates)
 */

type Setter = StoreSetter<AgentStore>;
export const createAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new AgentSliceActionImpl(set, get, _api);

export class AgentSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;
  /**
   * Keep persistence for one agent in user-intent order. The UI remains
   * optimistic, but the server's read/merge/write mutation must finish before
   * the next one starts or an older request can become the final database row.
   */
  readonly #agentMutationTails = new Map<string, Promise<void>>();
  readonly #pendingAgentDocuments = new Map<string, Promise<AgentContextDocument[] | undefined>>();
  /** Per-path ownership of `agentMap`, so a failed save undoes only its own writes. */
  readonly #writeLedger = new AgentWriteLedger();

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #syncAgentDocuments = (agentId: string, documents: AgentContextDocument[]) => {
    this.#set(
      (state) => ({
        agentDocumentsMap: {
          ...state.agentDocumentsMap,
          [agentId]: documents,
        },
      }),
      false,
      'syncAgentDocuments',
    );
  };

  #enqueueAgentMutation = <T>(agentId: string, mutation: () => Promise<T>): Promise<T> => {
    const previous = this.#agentMutationTails.get(agentId) ?? Promise.resolve();
    const result = previous.then(mutation, mutation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.#agentMutationTails.set(agentId, tail);
    void tail.then(() => {
      if (this.#agentMutationTails.get(agentId) === tail) {
        this.#agentMutationTails.delete(agentId);
      }
    });

    return result;
  };

  appendStreamingSystemRole = (chunk: string): void => {
    const currentContent = this.#get().streamingSystemRole || '';
    this.#set({ streamingSystemRole: currentContent + chunk }, false, 'appendStreamingSystemRole');
  };

  createAgent = async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    const result = await agentService.createAgent(params);
    this.#get().invalidateAvailableAgents();

    // Track new agent creation analytics
    const analytics = getSingletonAnalyticsOptional();
    if (analytics) {
      const userStore = getUserStoreState();
      const userId = userProfileSelectors.userId(userStore);

      analytics.track({
        name: 'new_agent_created',
        properties: {
          agent_id: result.agentId,
          assistant_name: params.config?.title || 'Untitled Agent',
          assistant_tags: params.config?.tags || [],
          user_id: userId || 'anonymous',
        },
      });
    }

    return result;
  };

  finishStreamingSystemRole = async (agentId: string): Promise<void> => {
    const { streamingSystemRole } = this.#get();

    if (!streamingSystemRole) {
      this.#set({ streamingSystemRoleInProgress: false }, false, 'finishStreamingSystemRole');
      return;
    }

    // Save the final content to agent config
    await this.#get().optimisticUpdateAgentConfig(agentId, {
      systemRole: streamingSystemRole,
    });

    // Reset streaming state
    this.#set(
      {
        streamingSystemRole: undefined,
        streamingSystemRoleInProgress: false,
      },
      false,
      'finishStreamingSystemRole',
    );
  };

  setActiveAgentId = (agentId?: string): void => {
    this.#set(
      (state) => (state.activeAgentId === agentId ? state : { activeAgentId: agentId }),
      false,
      'setActiveAgentId',
    );
  };

  setAgentPinned = (value: boolean | ((prev: boolean) => boolean)): void => {
    this.#set(
      (state) => ({
        isAgentPinned: typeof value === 'function' ? value(state.isAgentPinned) : value,
      }),
      false,
      'setAgentPinned',
    );
  };

  startStreamingSystemRole = (): void => {
    this.#set(
      {
        streamingSystemRole: '',
        streamingSystemRoleInProgress: true,
      },
      false,
      'startStreamingSystemRole',
    );
  };

  toggleAgentPinned = (): void => {
    this.#set((state) => ({ isAgentPinned: !state.isAgentPinned }), false, 'toggleAgentPinned');
  };

  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
  ): Promise<{ agentId: string; slug: string | null }> => {
    return agentService.transferAgent(agentId, targetWorkspaceId);
  };

  toggleAgentPlugin = async (pluginId: string, state?: boolean): Promise<void> => {
    const { activeAgentId, agentMap, updateAgentConfig } = this.#get();
    if (!activeAgentId) return;

    const currentPlugins = (agentMap[activeAgentId]?.plugins as string[]) || [];
    const hasPlugin = currentPlugins.includes(pluginId);

    // Determine new state
    const shouldEnable = state !== undefined ? state : !hasPlugin;

    let newPlugins: string[];
    if (shouldEnable && !hasPlugin) {
      newPlugins = [...currentPlugins, pluginId];
    } else if (!shouldEnable && hasPlugin) {
      newPlugins = currentPlugins.filter((id) => id !== pluginId);
    } else {
      // No change needed
      return;
    }

    await updateAgentConfig({ plugins: newPlugins });
  };

  updateAgentChatConfig = async (config: Partial<LobeAgentChatConfig>): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    await this.#get().updateAgentConfig({ chatConfig: config });
  };

  updateAgentChatConfigById = async (
    agentId: string,
    config: Partial<LobeAgentChatConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    await this.#get().updateAgentConfigById(agentId, { chatConfig: config });
  };

  updateAgentConfig = async (
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) {
      // A silent no-op would read as a successful save to a caller awaiting this promise.
      if (options?.throwOnError) throw new Error('No active agent to update');
      return;
    }

    const controller = this.#get().internal_createAbortController('updateAgentConfigSignal');

    await this.#get().optimisticUpdateAgentConfig(
      activeAgentId,
      config,
      controller.signal,
      options,
    );
  };

  updateAgentConfigById = async (
    agentId: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    if (!agentId) {
      if (options?.throwOnError) throw new Error('No agent id to update');
      return;
    }

    const controller = this.#get().internal_createAbortController('updateAgentConfigSignal');

    await this.#get().optimisticUpdateAgentConfig(agentId, config, controller.signal, options);
  };

  updateAgentRuntimeEnvConfigById = async (
    agentId: string,
    config: Partial<RuntimeEnvConfig>,
  ): Promise<void> => {
    if (!agentId) return;

    if (isDesktop && 'workingDirectory' in config && !config.workingDirectory) {
      // Compatibility storage is read/delete-only. New selections must be
      // persisted as formal project workspaces, never written back here.
      setLocalAgentWorkingDirectory(agentId, undefined);
      const nextMap = { ...this.#get().localAgentWorkingDirectoryMap };
      delete nextMap[agentId];
      this.#set({ localAgentWorkingDirectoryMap: nextMap }, false, 'updateAgentWorkingDirectory');
    }

    const restConfig = { ...config };
    delete restConfig.workingDirectory;
    if (Object.keys(restConfig).length > 0) {
      await this.#get().updateAgentChatConfigById(agentId, { runtimeEnv: restConfig });
    }
  };

  updateAgentMeta = async (meta: AgentMetaUpdate): Promise<void> => {
    const { activeAgentId } = this.#get();

    if (!activeAgentId) return;

    const controller = this.#get().internal_createAbortController('updateAgentMetaSignal');

    await this.#get().optimisticUpdateAgentMeta(activeAgentId, meta, controller.signal);
  };

  updateLoadingState = (key: keyof LoadingState, value: boolean): void => {
    this.#set(
      { loadingState: { ...this.#get().loadingState, [key]: value } },
      false,
      'updateLoadingState',
    );
  };

  updateSaveStatus = (status: SaveStatus): void => {
    this.#set(
      {
        lastUpdatedTime: status === 'saved' ? new Date() : this.#get().lastUpdatedTime,
        saveStatus: status,
      },
      false,
      'updateSaveStatus',
    );
  };

  useFetchAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          if (!data) return;
          this.#get().internal_dispatchAgentMap(agentId, data);
          // Only adopt the fetched agent as the active one when nothing is
          // active yet. The active agent is owned by the route-level sync
          // (AgentIdSync on desktop/mobile, the popup pages' own setState).
          // A background or secondary config fetch — e.g. the inbox config
          // requested by the home input, a side-panel copilot, or another
          // open tab — must NOT hijack `activeAgentId` away from the routed
          // agent, which would otherwise flash the conversation header/welcome
          // back to the inbox ("Masterino") agent.
          if (!this.#get().activeAgentId) {
            this.#set({ activeAgentId: data.id }, false, 'fetchAgentConfig');
          }
          this.#clearAgentConfigError(agentId);
        },
        onError: (error) => {
          this.#set(
            (state) => ({
              agentConfigErrorMap: {
                ...state.agentConfigErrorMap,
                [agentId]: error?.message || String(error),
              },
            }),
            false,
            'fetchAgentConfig/error',
          );
        },
      },
    );
  };

  /**
   * Re-trigger the agent config fetch after a failure. Clears the recorded
   * error first so consumers fall back to the loading skeleton, then
   * revalidates every SWR entry for this agent (keys may carry a workspace
   * suffix, hence the filter form).
   */
  retryAgentConfigFetch = async (agentId?: string): Promise<void> => {
    const id = agentId ?? this.#get().activeAgentId;
    if (!id) return;

    this.#clearAgentConfigError(id);

    await mutate(
      (key) => Array.isArray(key) && key[0] === agentConfigKeys.config.root && key[1] === id,
    );
  };

  #clearAgentConfigError = (agentId: string) => {
    if (!this.#get().agentConfigErrorMap[agentId]) return;

    this.#set(
      (state) => {
        const next = { ...state.agentConfigErrorMap };
        delete next[agentId];
        return { agentConfigErrorMap: next };
      },
      false,
      'clearAgentConfigError',
    );
  };

  useHydrateAgentConfig = (
    isLogin: boolean | undefined,
    agentId: string,
  ): SWRResponse<LobeAgentConfig> => {
    const swrKey =
      isLogin === true && agentId && !isChatGroupSessionId(agentId)
        ? agentConfigKeys.config(agentId)
        : null;

    return useClientDataSWRWithSync<LobeAgentConfig>(
      swrKey,
      async () => {
        const data = await agentService.getAgentConfigById(agentId);
        return data as LobeAgentConfig;
      },
      {
        onData: (data) => {
          if (!data) return;
          this.#get().internal_dispatchAgentMap(agentId, data);
        },
      },
    );
  };

  useFetchAgentDocuments = (agentId?: string | null): SWRResponse<AgentDocumentListItem[]> => {
    return useClientDataSWRWithSync<AgentDocumentListItem[]>(
      agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
      async () => agentDocumentService.listDocuments({ agentId: agentId! }),
      {
        revalidateOnFocus: false,
      },
    );
  };

  useFetchAvailableAgents = (enabled: boolean): SWRResponse<AvailableAgentItem[]> => {
    return useClientDataSWRWithSync<AvailableAgentItem[]>(
      enabled ? agentConfigKeys.available() : null,
      () => agentService.queryAgents({ limit: AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT }),
      {
        onData: (data) => {
          this.#set({ availableAgents: data }, false, 'useFetchAvailableAgents');
        },
        revalidateOnFocus: false,
      },
    );
  };

  invalidateAvailableAgents = (): void => {
    this.#set({ availableAgents: undefined }, false, 'invalidateAvailableAgents');
    void mutate(agentConfigKeys.available());
  };

  ensureAgentDocuments = async (
    agentId?: string | null,
  ): Promise<AgentContextDocument[] | undefined> => {
    if (!agentId) return undefined;

    const cachedDocuments = this.#get().agentDocumentsMap[agentId];
    if (cachedDocuments !== undefined) return cachedDocuments;

    const pendingRequest = this.#pendingAgentDocuments.get(agentId);
    if (pendingRequest) return pendingRequest;

    const request = resolveAgentDocumentsContext({ agentId })
      .then((documents) => {
        if (documents) {
          this.#syncAgentDocuments(agentId, documents);
        }

        return documents;
      })
      .finally(() => {
        this.#pendingAgentDocuments.delete(agentId);
      });

    this.#pendingAgentDocuments.set(agentId, request);

    return request;
  };

  /**
   * @returns the ticket this dispatch claimed for the paths it wrote, so an
   * optimistic caller can later ask whether it still owns them.
   */
  internal_dispatchAgentMap = (
    id: string,
    config: PartialDeep<LobeAgentConfig>,
    options?: Pick<AgentConfigUpdateOptions, 'replacePaths'>,
  ): number => {
    // Claimed before the write and before the no-op check below: re-writing the
    // value a pending request already put there is still a write, and it has to
    // take the path over, or that request could later roll the value back out
    // from under it.
    const ticket = this.#writeLedger.claimWrite(
      this.#get().agentMap,
      id,
      config,
      options?.replacePaths,
    );

    const agentMap = produce(this.#get().agentMap, (draft) => {
      if (!draft[id]) {
        draft[id] = config;
      } else {
        draft[id] = merge(draft[id], config);
      }

      for (const path of options?.replacePaths ?? []) {
        const replacement = getAtPath(config, path);
        if (replacement === undefined) continue;
        setAtPath(draft[id], path, replacement);
      }
    });

    if (isEqual(this.#get().agentMap, agentMap)) return ticket;

    this.#set({ agentMap }, false, 'dispatchAgentMap');

    return ticket;
  };

  optimisticUpdateAgentConfig = async (
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    _signal?: AbortSignal,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update (instant UI feedback)
    const ticket = internal_dispatchAgentMap(id, data, options);
    updateSaveStatus('saving');

    // Record what this request just wrote, under the ticket that owns it, so a
    // later rollback can tell its own write apart from a concurrent one — even
    // when the concurrent write happens to have set the same value.
    const optimisticWrite = this.#writeLedger.snapshotWrite(this.#get().agentMap, id, ticket);

    try {
      // 2. API call returns updated agent data
      // Never abort an already-issued mutation when the next optimistic edit
      // starts. HTTP cancellation cannot prove that the server stopped, and a
      // late older write could otherwise win in the database after the newer
      // intent. Serializing the un-aborted persistence calls preserves intent
      // order while the ledger keeps the visible UI fully optimistic.
      const result = await this.#enqueueAgentMutation(id, () =>
        agentService.updateAgentConfig(id, data),
      );

      // A response that does not confirm the write is a failure, not a save. Marking it
      // 'saved' would report success for a change the server never acknowledged.
      if (!result?.success || !result.agent) {
        throw new Error('Agent config update was not confirmed by the server');
      }

      // 3. Apply only response paths this request still owns. Mutation responses
      // contain the full agent; an older response must not overwrite a newer
      // optimistic or confirmed write that reached the same path first.
      const projected = this.#writeLedger.projectServerResponse(
        this.#get().agentMap,
        optimisticWrite,
        result.agent,
        options?.replacePaths,
      );
      if (projected) {
        internal_dispatchAgentMap(id, projected.data, { replacePaths: projected.replacePaths });
      }
      // The server confirmed this write, so no older request that fails later may
      // undo it on its way back to a value neither of them saved.
      this.#writeLedger.settleWrite(optimisticWrite);
      this.#get().invalidateAvailableAgents();
      updateSaveStatus('saved');
    } catch (error: any) {
      const aborted = error?.name === 'AbortError' || error?.message?.includes('aborted');
      if (!aborted) console.error('[AgentStore] Failed to save config:', error);
      updateSaveStatus('idle');

      // The write never landed, so the optimistic value must not stay on screen. Roll
      // back only the paths this update touched and still owns: restoring the whole
      // agent would clobber a concurrent successful write (e.g. a meta update) on other
      // fields, and restoring a path a later write took over would clobber it there.
      //
      // Aborts normally have a replacement write already standing on the same
      // path, in which case the rollback sweep leaves that winner untouched. If
      // no replacement exists (or it already failed), remove the unsaved value
      // now instead of leaving a failed tombstone visible indefinitely.
      if (aborted) {
        const agentMap = this.#writeLedger.abandonWrite(this.#get().agentMap, optimisticWrite);
        this.#set({ agentMap }, false, 'abandonAgentConfig');
      } else {
        const agentMap = this.#writeLedger.rollbackWrite(this.#get().agentMap, optimisticWrite);
        this.#set({ agentMap }, false, 'rollbackAgentConfig');
      }

      if (options?.throwOnError) throw error;
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    _signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update - meta fields are at the top level of agent config
    const ticket = internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');
    const optimisticWrite = this.#writeLedger.snapshotWrite(this.#get().agentMap, id, ticket);

    try {
      // 2. API call returns updated agent data
      const result = await this.#enqueueAgentMutation(id, () =>
        agentService.updateAgentMeta(id, meta),
      );

      if (!result?.success || !result.agent) {
        throw new Error('Agent meta update was not confirmed by the server');
      }

      // Meta endpoints also return the full agent. Project it through the same
      // ownership ledger as config writes so an unrelated pending field cannot
      // be replaced by a stale row snapshot.
      const projected = this.#writeLedger.projectServerResponse(
        this.#get().agentMap,
        optimisticWrite,
        result.agent,
      );
      if (projected) internal_dispatchAgentMap(id, projected.data);
      this.#writeLedger.settleWrite(optimisticWrite);
      this.#get().invalidateAvailableAgents();
      updateSaveStatus('saved');
    } catch (error: any) {
      const aborted = error?.name === 'AbortError' || error?.message?.includes('aborted');
      if (!aborted) console.error('[AgentStore] Failed to save meta:', error);
      updateSaveStatus('idle');

      const agentMap = aborted
        ? this.#writeLedger.abandonWrite(this.#get().agentMap, optimisticWrite)
        : this.#writeLedger.rollbackWrite(this.#get().agentMap, optimisticWrite);
      this.#set({ agentMap }, false, aborted ? 'abandonAgentMeta' : 'rollbackAgentMeta');
    }
  };

  internal_refreshAgentConfig = async (id: string): Promise<void> => {
    await mutate(agentConfigKeys.config(id));
  };

  internal_createAbortController = (key: keyof AgentSliceState): AbortController => {
    const abortController = this.#get()[key] as AbortController;
    if (abortController) abortController.abort(MESSAGE_CANCEL_FLAT);
    const controller = new AbortController();
    this.#set({ [key]: controller }, false, 'internal_createAbortController');

    return controller;
  };
}

export type AgentSliceAction = Pick<AgentSliceActionImpl, keyof AgentSliceActionImpl>;
