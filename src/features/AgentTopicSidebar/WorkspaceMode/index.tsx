'use client';

import { Accordion, Flexbox, Text } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
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
import { useWorkspaceTopicNavigation } from './useWorkspaceTopicNavigation';
import WorkspaceGroupItem from './WorkspaceGroupItem';

/**
 * Fixed Topic information architecture: formal workspace groups on top, a
 * flat "recent" list pinned at the bottom. Placement comes exclusively from
 * the accepted `classifyTopicPlacement`; the two sets never overlap.
 */
const WorkspaceMode = memo(() => {
  const { t } = useTranslation(['topic', 'chat']);
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

  const { navigation, groupIds, topicSortBy } = useWorkspaceTopicNavigation();

  const [topicGroupKeys, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.topicGroupKeys(s),
    s.updateSystemStatus,
  ]);

  useEffect(() => {
    updateSystemStatus({ expandTopicGroupKeys: undefined });
  }, [topicSortBy, updateSystemStatus]);

  const expandedKeys = useMemo(() => topicGroupKeys || groupIds, [topicGroupKeys, groupIds]);

  return (
    <Flexbox gap={2}>
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
