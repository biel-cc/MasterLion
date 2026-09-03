import { isDesktop } from '@lobechat/const';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import {
  buildWorkspaceTopicNavigation,
  useProjectWorkspaceStore,
  type WorkspaceTopicNavigation,
} from '@/store/projectWorkspace';
import { useUserStore } from '@/store/user';
import { authSelectors, preferenceSelectors } from '@/store/user/selectors';
import type { TopicSortBy } from '@/types/topic';

export interface WorkspaceTopicNavigationView {
  groupIds: string[];
  navigation: WorkspaceTopicNavigation;
  topicSortBy: TopicSortBy;
}

/**
 * Derives the fixed sidebar navigation from the page-sliced, completed-filtered
 * topic list (`displayTopicsForSidebar`) and server workspace evidence.
 * Group ids are always `project_workspaces` ids.
 */
export const useWorkspaceTopicNavigation = (): WorkspaceTopicNavigationView => {
  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const isLogin = useUserStore(authSelectors.isLogin);

  useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(isLogin || isDesktop);

  const topics = useChatStore(
    topicSelectors.displayTopicsForSidebar(topicPageSize, topicSortBy),
    isEqual,
  );
  const topicStatesById = useProjectWorkspaceStore((s) => s.topicStatesById);
  const workspacesById = useProjectWorkspaceStore((s) => s.workspacesById);

  const navigation = useMemo(
    () =>
      buildWorkspaceTopicNavigation(topics ?? [], {
        sortBy: topicSortBy,
        topicStatesById,
        workspacesById,
      }),
    [topics, topicSortBy, topicStatesById, workspacesById],
  );

  const groupIds = useMemo(
    () => navigation.workspaceGroups.map((group) => group.workspaceId),
    [navigation],
  );

  return useMemo(
    () => ({ groupIds, navigation, topicSortBy }),
    [groupIds, navigation, topicSortBy],
  );
};
