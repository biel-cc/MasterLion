import { isDesktop } from '@lobechat/const';
import { type AgentContextDocument } from '@lobechat/context-engine';
import { isChatGroupSessionId } from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import {
  get as getAtPath,
  has as hasAtPath,
  isPlainObject,
  set as setAtPath,
  toPath,
  unset as unsetAtPath,
} from 'es-toolkit/compat';
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

type AgentMap = Record<string, PartialDeep<AgentItem>>;

/**
 * Paths this update actually writes through the deep merge. Arrays and scalars
 * are leaves because `merge` replaces them wholesale; `undefined` writes
 * nothing and an empty object merges to a no-op, so neither owns a path.
 */
// `isPlainObject` from es-toolkit/compat returns a plain boolean, so narrow the
// unknown ourselves to keep `Object.entries` typed.
const isPlainRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);

const collectWrittenPaths = (value: unknown, prefix: string[], out: string[][]): void => {
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectWrittenPaths(child, [...prefix, key], out);
    }
    return;
  }

  if (value === undefined || prefix.length === 0) return;

  out.push(prefix);
};

const isPathPrefix = (prefix: string[], path: string[]): boolean =>
  prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);

/**
 * The paths a failed update owns: every replaced subtree (the whole subtree is
 * one unit, so leaves under it are dropped) plus the deep-merged leaves.
 */
const resolveWrittenPaths = (
  data: PartialDeep<LobeAgentConfig>,
  replacePaths?: string[],
): string[][] => {
  // Mirrors internal_dispatchAgentMap: a replace path with no value in the
  // payload is skipped there, so it never wrote anything to undo.
  const replaced = (replacePaths ?? [])
    .filter((path) => getAtPath(data, path) !== undefined)
    .map((path) => toPath(path));

  const merged: string[][] = [];
  collectWrittenPaths(data, [], merged);

  return [
    ...replaced,
    ...merged.filter((path) => !replaced.some((prefix) => isPathPrefix(prefix, path))),
  ];
};

/**
 * A monotonic stamp handed to one dispatch. Ownership is identified by stamp,
 * never by value: two writes that happen to set the same value are different
 * writes, so the older one must not be able to claim the newer one's state.
 */
let lastWriteTicket = 0;
const nextWriteTicket = (): number => {
  lastWriteTicket += 1;

  return lastWriteTicket;
};

/** Which dispatch last landed on one path. */
interface PathWriteRecord {
  path: string[];
  ticket: number;
}

/**
 * The write ledger of one agent: path -> the dispatch that last wrote it.
 *
 * Deliberately kept out of `agentMap`, which is persisted and handed to the
 * browser as agent config — a version stamp stored there would show up in the
 * user's saved config and travel to the server. Its lifetime is instead tied to
 * the agent entry: {@link AgentSliceActionImpl} drops an agent's ledger as soon
 * as the agent leaves the map, so a deleted agent leaves nothing behind.
 */
type AgentWriteLedger = Map<string, PathWriteRecord>;

const pathKey = (path: string[]): string => JSON.stringify(path);

const arePathsOverlapping = (a: string[], b: string[]): boolean =>
  isPathPrefix(a, b) || isPathPrefix(b, a);

/**
 * Record that this dispatch now owns every path it wrote.
 *
 * A write at `agencyConfig.env` lands on everything under it, so the records of
 * those descendants are dropped: their owners have already lost to this ticket,
 * and this record answers for them. Ancestor records are kept — they hold an
 * older ticket, so they still lose to this one, and they still own their other
 * branches. That also bounds the ledger to the agent's own path set.
 */
const claimWrittenPaths = (ledger: AgentWriteLedger, paths: string[][], ticket: number): void => {
  for (const path of paths) {
    for (const [key, record] of ledger) {
      if (record.path.length > path.length && isPathPrefix(path, record.path)) ledger.delete(key);
    }

    ledger.set(pathKey(path), { path, ticket });
  }
};

/**
 * Whether the dispatch holding `ticket` is still the writer of `path`.
 *
 * Losing the record at all — overwritten by a same-path write, swept away with
 * a replaced ancestor, or dropped with the agent — means someone else took the
 * path over. Overlap counts as a takeover in both directions: a later leaf write
 * owns part of what an earlier subtree replace wrote, so that subtree can no
 * longer be undone as one unit, and a later subtree replace covers an earlier
 * leaf.
 */
const stillOwnsWrittenPath = (
  ledger: AgentWriteLedger | undefined,
  path: string[],
  ticket: number,
): boolean => {
  if (!ledger) return false;

  const record = ledger.get(pathKey(path));
  if (!record || record.ticket !== ticket) return false;

  for (const other of ledger.values()) {
    if (other.ticket > ticket && arePathsOverlapping(other.path, path)) return false;
  }

  return true;
};

/**
 * What this update left at one path once its optimistic write landed: the
 * value plus whether the path exists at all.
 */
interface OptimisticWrite {
  /** Whether the path exists, so a later deletion is not mistaken for our value. */
  present: boolean;
  path: string[];
  value: unknown;
}

/** One request's optimistic writes, together with the ticket that owns them. */
interface OptimisticWriteBatch {
  ticket: number;
  writes: OptimisticWrite[];
}

/**
 * Read back what the optimistic dispatch actually put in the map, rather than
 * assuming it equals the payload: `merge` decides how a value lands, and a
 * path it did not write must not be claimed by the rollback.
 */
const snapshotOptimisticWrites = (
  agent: PartialDeep<AgentItem> | undefined,
  paths: string[][],
): OptimisticWrite[] =>
  paths.map((path) => ({
    present: agent !== undefined && hasAtPath(agent, path),
    path,
    value: agent === undefined ? undefined : getAtPath(agent, path),
  }));

/**
 * Secondary guard, on top of the ledger: the value must also still be the one
 * we wrote. The ledger only sees writes that go through `internal_dispatchAgentMap`,
 * so this catches a path changed by something that sets `agentMap` directly.
 * It is a backstop, not the ownership test — a same-value write is caught by the
 * ticket, which this check cannot see.
 */
const stillHoldsOptimisticValue = (
  current: PartialDeep<AgentItem>,
  { path, present, value }: OptimisticWrite,
): boolean => {
  if (hasAtPath(current, path) !== present) return false;
  if (!present) return true;

  return isEqual(getAtPath(current, path), value);
};

/**
 * Undo only the paths this update wrote and still owns. Restoring the whole
 * pre-update agent would discard any concurrent successful write — e.g. a meta
 * update that landed while this config save was still in flight — and undoing a
 * path a later write took over would overwrite the winner with a value older
 * than either, a silent data loss the user never sees.
 *
 * Consumes the records it undoes: a rolled-back write no longer exists, so it
 * should not keep a path (an env key the user has since deleted, say) on the
 * ledger for the rest of the session.
 */
const rollbackWrittenPaths = (
  agentMap: AgentMap,
  id: string,
  previousAgent: PartialDeep<AgentItem> | undefined,
  { ticket, writes }: OptimisticWriteBatch,
  ledger: AgentWriteLedger | undefined,
): AgentMap => {
  const currentAgent = agentMap[id];
  // A newer write already dropped the entry; it owns the state now.
  if (!currentAgent) return agentMap;

  const paths = writes
    .filter(
      (write) =>
        stillOwnsWrittenPath(ledger, write.path, ticket) &&
        stillHoldsOptimisticValue(currentAgent, write),
    )
    .map((write) => write.path);

  for (const path of paths) ledger?.delete(pathKey(path));

  return produce(agentMap, (draft) => {
    const current = draft[id];
    if (!current) return;

    for (const path of paths) {
      // `has`, not a value check: it is what separates "was `undefined`" from
      // "was absent", so a key this update created is deleted rather than left
      // behind as an explicit `undefined`.
      if (previousAgent !== undefined && hasAtPath(previousAgent, path)) {
        setAtPath(current, path, getAtPath(previousAgent, path));
        continue;
      }

      unsetAtPath(current, path);

      // Drop the empty object husks this update created on the way to the leaf,
      // stopping at the first ancestor that existed before it.
      for (let depth = path.length - 1; depth > 0; depth -= 1) {
        const ancestorPath = path.slice(0, depth);
        if (previousAgent !== undefined && hasAtPath(previousAgent, ancestorPath)) break;

        // Checked structurally rather than via `isPlainObject` because this
        // reads through an immer draft proxy.
        const ancestor: unknown = getAtPath(current, ancestorPath);
        if (typeof ancestor !== 'object' || ancestor === null) break;
        if (Array.isArray(ancestor) || Object.keys(ancestor).length > 0) break;

        unsetAtPath(current, ancestorPath);
      }
    }

    // The entry only existed because of this update, and nothing else has
    // written to it since.
    if (previousAgent === undefined && Object.keys(current).length === 0) delete draft[id];
  });
};

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
  readonly #pendingAgentDocuments = new Map<string, Promise<AgentContextDocument[] | undefined>>();
  /** agent id -> its write ledger; see {@link AgentWriteLedger} for why it lives here. */
  readonly #writeLedgers = new Map<string, AgentWriteLedger>();

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

    if (isDesktop && 'workingDirectory' in config) {
      setLocalAgentWorkingDirectory(agentId, config.workingDirectory);
      const nextMap = { ...this.#get().localAgentWorkingDirectoryMap };
      if (config.workingDirectory) {
        nextMap[agentId] = config.workingDirectory;
      } else {
        delete nextMap[agentId];
      }
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
   * A write ledger only means anything while its agent is in the map, so an
   * agent that has been deleted — here or by any other slice — takes its ledger
   * with it. Without this the ledgers would grow for the lifetime of the tab.
   */
  #releaseLedgersForMissingAgents = (agentMap: AgentMap): void => {
    for (const id of this.#writeLedgers.keys()) {
      if (!(id in agentMap)) this.#writeLedgers.delete(id);
    }
  };

  #claimPathsForDispatch = (id: string, paths: string[][]): number => {
    const ticket = nextWriteTicket();
    // A dispatch that writes nothing owns nothing, and must not open a ledger.
    if (paths.length === 0) return ticket;

    let ledger = this.#writeLedgers.get(id);
    if (!ledger) {
      ledger = new Map();
      this.#writeLedgers.set(id, ledger);
    }

    claimWrittenPaths(ledger, paths, ticket);

    return ticket;
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
    // Swept against the map as it is now, before this dispatch can re-create a
    // deleted agent: an entry that is gone takes the ownership of every request
    // still in flight against it with it.
    this.#releaseLedgersForMissingAgents(this.#get().agentMap);

    // Claimed before the no-op check below: re-writing the value a pending request
    // already put there is still a write, and it has to take the path over, or that
    // request could later roll the value back out from under it.
    const ticket = this.#claimPathsForDispatch(
      id,
      resolveWrittenPaths(config, options?.replacePaths),
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
    signal?: AbortSignal,
    options?: AgentConfigUpdateOptions,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();
    const previousAgent = this.#get().agentMap[id];

    // 1. Optimistic update (instant UI feedback)
    const ticket = internal_dispatchAgentMap(id, data, options);
    updateSaveStatus('saving');

    // Snapshot what this request just wrote, under the ticket that owns it, so a
    // later rollback can tell its own write apart from a concurrent one — even
    // when the concurrent write happens to have set the same value.
    const optimisticWrites: OptimisticWriteBatch = {
      ticket,
      writes: snapshotOptimisticWrites(
        this.#get().agentMap[id],
        resolveWrittenPaths(data, options?.replacePaths),
      ),
    };

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentConfig(id, data, signal);

      // A response that does not confirm the write is a failure, not a save. Marking it
      // 'saved' would report success for a change the server never acknowledged.
      if (!result?.success || !result.agent) {
        throw new Error('Agent config update was not confirmed by the server');
      }

      // 3. Use returned data directly (no refetch needed!)
      internal_dispatchAgentMap(id, result.agent, options);
      this.#get().invalidateAvailableAgents();
      updateSaveStatus('saved');
    } catch (error: any) {
      const aborted = error?.name === 'AbortError' || error?.message?.includes('aborted');
      if (!aborted) console.error('[AgentStore] Failed to save config:', error);
      updateSaveStatus('idle');

      // The write never landed, so the optimistic value must not stay on screen. An abort
      // means a newer write already owns that state, so leave the map to the newer write.
      // Roll back only the paths this update touched and still owns: restoring the whole
      // agent would clobber a concurrent successful write (e.g. a meta update) on other
      // fields, and restoring a path a later write took over would clobber it there.
      if (!aborted) {
        const agentMap = rollbackWrittenPaths(
          this.#get().agentMap,
          id,
          previousAgent,
          optimisticWrites,
          this.#writeLedgers.get(id),
        );
        this.#set({ agentMap }, false, 'rollbackAgentConfig');
        // The rollback may have removed the agent it created.
        this.#releaseLedgersForMissingAgents(agentMap);
      }

      if (options?.throwOnError) throw error;
    }
  };

  optimisticUpdateAgentMeta = async (
    id: string,
    meta: AgentMetaUpdate,
    signal?: AbortSignal,
  ): Promise<void> => {
    const { internal_dispatchAgentMap, updateSaveStatus } = this.#get();

    // 1. Optimistic update - meta fields are at the top level of agent config
    internal_dispatchAgentMap(id, meta as PartialDeep<LobeAgentConfig>);
    updateSaveStatus('saving');

    try {
      // 2. API call returns updated agent data
      const result = await agentService.updateAgentMeta(id, meta, signal);

      // 3. Use returned data directly (no refetch needed!)
      if (result?.success && result.agent) {
        internal_dispatchAgentMap(id, result.agent);
        this.#get().invalidateAvailableAgents();
      }
      updateSaveStatus('saved');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        updateSaveStatus('idle');
      } else {
        console.error('[AgentStore] Failed to save meta:', error);
        updateSaveStatus('idle');
      }
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
