'use client';

import { Accordion, ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { MoreHorizontal, PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { message } from '@/components/AntdStaticMethods';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { electronSystemService } from '@/services/electron/system';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

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
  const [addingProject, setAddingProject] = useState(false);

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
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const getOrCreateDeviceWorkspace = useProjectWorkspaceStore((s) => s.getOrCreateDeviceWorkspace);

  const handleAddProject = useCallback(async () => {
    if (!activeAgentId || !currentDeviceId || addingProject) return;

    setAddingProject(true);
    try {
      const selected = await electronSystemService.selectFolder({
        title: tw('workspaceRuntime.sidebar.chooseProjectFolder', { ns: 'chat' }),
      });
      if (!selected) return;

      // Use the same draft-only compatibility path as historical project rows.
      // An old server cannot create a formal workspace; never invent its id or
      // change the agent-wide default to make this one topic use the folder.
      const startLegacyTopic = () =>
        useChatStore.getState().startNewTopic({
          legacyWorkingDirectory: selected.path,
          target: 'local',
          targetDeviceId: currentDeviceId,
        });
      if (!useProjectWorkspaceStore.getState().seamAvailable) {
        await startLegacyTopic();
        return;
      }

      const result = await getOrCreateDeviceWorkspace({
        deviceId: currentDeviceId,
        repoType: selected.repoType,
        rootPath: selected.path,
      });
      if (!result.ok) {
        if (result.code === 'SEAM_UNAVAILABLE') {
          await startLegacyTopic();
          return;
        }
        message.error(tw('workspaceRuntime.sidebar.addProjectFailed', { ns: 'chat' }));
        return;
      }

      await useChatStore.getState().startNewTopic({
        target: 'local',
        targetDeviceId: currentDeviceId,
        workspaceId: result.value.id,
      });
    } catch {
      message.error(tw('workspaceRuntime.sidebar.addProjectFailed', { ns: 'chat' }));
    } finally {
      setAddingProject(false);
    }
  }, [activeAgentId, addingProject, currentDeviceId, getOrCreateDeviceWorkspace, tw]);

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

  // A persisted accordion selection predates newly created projects. Reveal a
  // new group once its first topic becomes active, regardless of which arrives
  // first. Consume it once so streaming updates cannot undo a manual collapse.
  const observedGroups = useRef({
    agentId: activeAgentId,
    pending: new Set<string>(),
    seen: new Set(groupIds),
  });
  useEffect(() => {
    const observed = observedGroups.current;
    if (observed.agentId !== activeAgentId || loading) {
      observedGroups.current = {
        agentId: activeAgentId,
        pending: new Set(),
        seen: new Set(groupIds),
      };
      return;
    }

    for (const id of groupIds) {
      if (!observed.seen.has(id)) observed.pending.add(id);
      observed.seen.add(id);
    }
    const activeGroup = navigation.workspaceGroups.find((group) =>
      group.topics.some((topic) => topic.id === activeTopicId),
    );
    if (!activeGroup || !observed.pending.delete(activeGroup.workspaceId)) return;
    if (topicGroupKeys && !topicGroupKeys.includes(activeGroup.workspaceId)) {
      updateSystemStatus({ expandTopicGroupKeys: [...topicGroupKeys, activeGroup.workspaceId] });
    }
  }, [
    activeAgentId,
    activeTopicId,
    groupIds,
    loading,
    navigation,
    topicGroupKeys,
    updateSystemStatus,
  ]);

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
          <ActionIcon
            disabled={!activeAgentId || !currentDeviceId}
            icon={PlusIcon}
            loading={addingProject}
            size="small"
            title={tw('workspaceRuntime.sidebar.addProject', { ns: 'chat' })}
            tooltipProps={{ placement: 'right' }}
            onClick={() => void handleAddProject()}
          />
        </Flexbox>
        {navigation.workspaceGroups.length > 0 && (
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
        )}
      </Flexbox>
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
