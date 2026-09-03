import { createWithEqualityFn } from 'zustand/traditional';

export { buildDraftConversationKey } from '../../../src/store/projectWorkspace/draftKey';
export { buildWorkspaceTopicNavigation } from '../../../src/store/projectWorkspace/topicNavigation';

const noop = () => undefined;
const noopAsync = async () => undefined;

export const useAgentStore = createWithEqualityFn<any>()(() => ({
  activeAgentId: undefined,
  agentMap: {},
  builtinAgentIdMap: {},
  updateAgentChatConfig: noopAsync,
}));

export const useChatStore = createWithEqualityFn<any>()((set) => ({
  activeAgentId: undefined,
  activeGroupId: undefined,
  activeThreadId: undefined,
  activeTopicId: undefined,
  agentTopicsViewMap: {},
  allTopicsDrawerOpen: false,
  autoRenameTopicTitle: noopAsync,
  closeAllTopicsDrawer: () => set({ allTopicsDrawerOpen: false }),
  duplicateTopic: noopAsync,
  favoriteTopic: noopAsync,
  importTopic: noopAsync,
  inSearchingMode: false,
  isSearchingTopic: false,
  loadMoreTopics: noopAsync,
  markTopicCompleted: noopAsync,
  messageOperationMap: {},
  operationIds: [],
  operations: {},
  operationsByContext: {},
  operationsByMessage: {},
  operationsByType: {},
  removeSessionTopics: noopAsync,
  removeTopic: noopAsync,
  removeUnstarredTopic: noopAsync,
  searchTopics: [],
  switchThread: noop,
  switchTopic: (id?: string) => set({ activeTopicId: id }),
  topicDataMap: {},
  topicLoadingIds: [],
  topicRenamingId: '',
  unreadCompletedTopicsByAgent: {},
  unmarkTopicCompleted: noopAsync,
  updateThreadTitle: noopAsync,
  updateTopicTitle: noopAsync,
  useSearchTopics: noop,
}));

export const useElectronStore = createWithEqualityFn<any>()(() => ({
  addTab: noop,
  gatewayDeviceInfo: undefined,
}));

export const useGlobalStore = createWithEqualityFn<any>()((set, get) => ({
  openTopicInNewWindow: noop,
  status: { expandTopicGroupKeys: undefined, topicPageSize: 20 },
  toggleMobileTopic: noop,
  updateSystemStatus: (value: Record<string, unknown>) =>
    set({ status: { ...get().status, ...value } }),
}));

export const useProjectWorkspaceStore = createWithEqualityFn<any>()(() => ({
  isWorkspacesInit: false,
  seamAvailable: true,
  setDraftWorkspaceIntent: noop,
  topicStatesById: {},
  useFetchWorkspaces: () => ({
    data: [],
    error: undefined,
    isLoading: false,
    mutate: noopAsync,
  }),
  workspaceIdsByDevice: {},
  workspacesById: {},
}));

export const useUserStore = createWithEqualityFn<any>()((set, get) => ({
  isSignedIn: false,
  isUserStateInit: true,
  preference: {
    topicGroupMode: 'byProject',
    topicIncludeCompleted: true,
    topicSortBy: 'updatedAt',
  },
  updatePreference: (value: Record<string, unknown>) =>
    set({ preference: { ...get().preference, ...value } }),
}));

export const useAiInfraStore = createWithEqualityFn<any>()(() => ({ enabledAiModels: undefined }));
