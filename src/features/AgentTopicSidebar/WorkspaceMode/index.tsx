'use client';

import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { MoreHorizontal, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import RecentSection from './RecentSection';
import type { WorkspaceTopicItemComponent } from './types';
import { useWorkspaceTopicNavigation } from './useWorkspaceTopicNavigation';
import WorkspaceGroupItem from './WorkspaceGroupItem';

/**
 * Fixed Topic information architecture: formal workspace groups on top, a
 * flat "recent" list pinned at the bottom. Placement comes exclusively from
 * the accepted `classifyTopicPlacement`; the two sets never overlap.
 */
export interface WorkspaceModeProps {
  TopicItemComponent: WorkspaceTopicItemComponent;
}

const WorkspaceMode = memo<WorkspaceModeProps>(({ TopicItemComponent }) => {
  const { t } = useTranslation(['topic', 'chat']);
  const tw = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const navigate = useNavigate();

  const [activeTopicId, activeThreadId, hasMore, isExpandingPageSize, activeAgentId] = useChatStore(
    (s) => [
      s.activeTopicId,
      s.activeThreadId,
      topicSelectors.hasMoreTopicsForSidebar(s),
      topicSelectors.isExpandingPageSize(s),
      s.activeAgentId,
    ],
  );

  const { navigation, groupIds, loadError, loading, reload, topicSortBy } =
    useWorkspaceTopicNavigation();

  const [topicGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicGroupKeys(s),
    s.updateSystemStatus,
  ]);

  // Grouping only changes meaning when the sort key changes, so only a real
  // change clears the persisted selection. Running this on mount would wipe the
  // user's collapse/expand choice every time the sidebar remounts (route change,
  // panel toggle) or this effect re-runs.
  const lastTopicSortBy = useRef(topicSortBy);
  useEffect(() => {
    if (lastTopicSortBy.current === topicSortBy) return;

    lastTopicSortBy.current = topicSortBy;
    updateSystemStatus({ expandTopicGroupKeys: undefined });
  }, [topicSortBy, updateSystemStatus]);

  // No stored selection means "all groups open"; an explicit empty array is a
  // deliberate "all collapsed" and must survive.
  const expandedKeys = useMemo(() => topicGroupKeys ?? groupIds, [topicGroupKeys, groupIds]);
  const hasNavigation = navigation.workspaceGroups.length > 0 || navigation.recent.length > 0;

  if (loading && !hasNavigation) return <SkeletonList rows={4} />;

  return (
    <Flexbox gap={2}>
      {Boolean(loadError) && (
        <Flexbox data-testid="topic-workspace-load-error" role="alert">
          <NavItem
            icon={TriangleAlertIcon}
            title={tw('workspaceRuntime.sidebar.loadError', { ns: 'chat' })}
          />
          <NavItem
            icon={RefreshCwIcon}
            title={tw('workspaceRuntime.sidebar.retry', { ns: 'chat' })}
            onClick={() => void reload()}
          />
        </Flexbox>
      )}
      {navigation.workspaceGroups.length > 0 && (
        <Flexbox data-testid="topic-workspace-section" gap={2}>
          <Flexbox
            horizontal
            align="center"
            gap={4}
            height={28}
            paddingInline={'8px 4px'}
            style={{ overflow: 'hidden' }}
          >
            <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
              {t('workspaceRuntime.sidebar.workspaces' as any, { ns: 'chat' })}
            </Text>
          </Flexbox>
          <Accordion
            expandedKeys={expandedKeys}
            gap={2}
            onExpandedChange={(keys) => updateSystemStatus({ expandTopicGroupKeys: keys as any })}
          >
            {navigation.workspaceGroups.map((group) => (
              <WorkspaceGroupItem
                TopicItemComponent={TopicItemComponent}
                activeThreadId={activeThreadId}
                activeTopicId={activeTopicId}
                expanded={expandedKeys.includes(group.workspaceId)}
                group={group}
                key={group.workspaceId}
              />
            ))}
          </Accordion>
        </Flexbox>
      )}
      <RecentSection
        TopicItemComponent={TopicItemComponent}
        activeThreadId={activeThreadId}
        activeTopicId={activeTopicId}
        entries={navigation.recent}
      />
      {isExpandingPageSize && <SkeletonList rows={3} />}
      {hasMore && !isExpandingPageSize && activeAgentId && (
        <NavItem
          icon={MoreHorizontal}
          title={t('loadMore')}
          onClick={() => navigate(urlJoin('/agent', activeAgentId, 'topics'))}
        />
      )}
    </Flexbox>
  );
});

WorkspaceMode.displayName = 'WorkspaceMode';

export default WorkspaceMode;
