const currentTopicData = (state: any) =>
  state.topicDataMap?.[
    state.activeGroupId
      ? state.activeAgentId
        ? `group_agent_${state.activeGroupId}_${state.activeAgentId}`
        : `group_${state.activeGroupId}`
      : `agent_${state.activeAgentId}`
  ];

const currentTopics = (state: any) => currentTopicData(state)?.items;
const visibleTopics = (state: any) =>
  currentTopics(state)?.filter((topic: any) => topic.trigger !== 'cron');

export const topicSelectors = {
  currentTopicCount: (state: any) => currentTopicData(state)?.total ?? 0,
  currentTopicLength: (state: any) => visibleTopics(state)?.length ?? 0,
  displayTopicsForSidebar: (pageSize: number) => (state: any) =>
    visibleTopics(state)?.slice(0, pageSize),
  groupedTopicsForSidebar: () => () => [],
  hasMoreTopicsForSidebar: (state: any) => Boolean(currentTopicData(state)?.hasMore),
  isExpandingPageSize: (state: any) => Boolean(currentTopicData(state)?.isExpandingPageSize),
  isUndefinedTopics: (state: any) => !currentTopics(state),
};

export const operationSelectors = {
  getAgentRuntimeStartTimeByContext: () => () => undefined,
  isTopicUnreadCompleted: () => () => false,
  unreadCompletedCountForTopics: () => () => 0,
};

export const agentSelectors = {
  currentAgentConfig: (state: any) => state.agentMap?.[state.activeAgentId],
  currentAgentHeterogeneousProviderType: () => undefined,
  isCurrentAgentHeterogeneous: () => false,
};

export const systemStatusSelectors = {
  topicGroupKeys: (state: any) => state.status?.expandTopicGroupKeys,
  topicPageSize: (state: any) => state.status?.topicPageSize ?? 20,
};

export const preferenceSelectors = {
  topicGroupMode: (state: any) => state.preference?.topicGroupMode ?? 'byProject',
  topicIncludeCompleted: (state: any) => state.preference?.topicIncludeCompleted ?? false,
  topicSortBy: (state: any) => state.preference?.topicSortBy ?? 'updatedAt',
};

export const authSelectors = {
  isLogin: (state: any) => Boolean(state.isSignedIn),
};
