import { isDesktop } from '@lobechat/const';
import { AccordionItem, ActionIcon, Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderClosedIcon, FolderOpenIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import {
  buildDraftConversationKey,
  type TopicNavigationWorkspaceGroup,
  useProjectWorkspaceStore,
} from '@/store/projectWorkspace';

import TopicItem from '../../List/Item';
import {
  getProjectTopicStatusCounts,
  hasProjectTopicStatusCounts,
} from '../ByProjectMode/statusCounts';
import { CollapsedStatusBadges, CollapsedUnreadDot } from './CollapsedIndicators';

const styles = createStaticStyles(({ css }) => ({
  addTopicAction: css`
    pointer-events: none;

    overflow: hidden;
    display: inline-flex;

    width: 0;

    opacity: 0;

    transition:
      width 150ms ${cssVar.motionEaseOut},
      opacity 150ms ${cssVar.motionEaseOut};

    &:focus-within,
    .accordion-header:hover & {
      pointer-events: auto;
      width: 24px;
      opacity: 1;
    }
  `,
}));

const getDirName = (path: string) => path.split('/').findLast(Boolean) || path;

export interface WorkspaceGroupItemProps {
  activeThreadId?: string;
  activeTopicId?: string;
  expanded: boolean;
  group: TopicNavigationWorkspaceGroup;
}

/**
 * One formal workspace group. Its "+" only records a draft intent for the
 * current conversation container and opens a fresh draft; it never writes
 * agent defaults, device defaults or agency config.
 */
const WorkspaceGroupItem = memo<WorkspaceGroupItemProps>(
  ({ group, activeTopicId, activeThreadId, expanded }) => {
    const { t } = useTranslation('chat');
    const { workspaceId, workspace, topics } = group;

    const title = workspace?.displayName || getDirName(workspace?.rootPath ?? workspaceId);
    const rootPath = workspace?.rootPath;

    const [activeAgentId, activeGroupId] = useChatStore((s) => [s.activeAgentId, s.activeGroupId]);
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const setDraftWorkspaceIntent = useProjectWorkspaceStore((s) => s.setDraftWorkspaceIntent);

    const handleAddTopic = useCallback(() => {
      if (!activeAgentId) return;
      const target =
        workspace?.kind === 'sandbox'
          ? 'sandbox'
          : isDesktop && workspace?.deviceId && workspace.deviceId === currentDeviceId
            ? 'local'
            : 'device';
      setDraftWorkspaceIntent(
        buildDraftConversationKey({ agentId: activeAgentId, groupId: activeGroupId }),
        { target, targetDeviceId: workspace?.deviceId, workspaceId },
      );
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }, [
      activeAgentId,
      activeGroupId,
      currentDeviceId,
      setDraftWorkspaceIntent,
      workspace,
      workspaceId,
    ]);

    const canAddTopic = !!activeAgentId;

    const loadingTopicIds = useChatStore((s) => s.topicLoadingIds);
    const statusCounts = useMemo(
      () => getProjectTopicStatusCounts(topics, new Set(loadingTopicIds)),
      [topics, loadingTopicIds],
    );
    const childTopicIds = useMemo(() => topics.map((topic) => topic.id), [topics]);
    const unreadCount = useChatStore(
      operationSelectors.unreadCompletedCountForTopics(childTopicIds),
    );
    const hasCollapsedStatus = !expanded && hasProjectTopicStatusCounts(statusCounts);
    const hasCollapsedUnread = !expanded && unreadCount > 0;
    const hasCollapsedIndicators = hasCollapsedStatus || hasCollapsedUnread;
    const FolderIcon = expanded ? FolderOpenIcon : FolderClosedIcon;

    const action =
      canAddTopic || hasCollapsedIndicators ? (
        <Flexbox horizontal align={'center'} gap={4}>
          {hasCollapsedStatus && <CollapsedStatusBadges counts={statusCounts} />}
          {hasCollapsedUnread && <CollapsedUnreadDot count={unreadCount} />}
          {canAddTopic && (
            <span className={hasCollapsedIndicators ? styles.addTopicAction : undefined}>
              <ActionIcon
                icon={PlusIcon}
                size={'small'}
                title={t('workspaceRuntime.sidebar.addTopicInWorkspace' as any, { name: title })}
                tooltipProps={{ placement: 'right' }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddTopic();
                }}
              />
            </span>
          )}
        </Flexbox>
      ) : undefined;

    return (
      <AccordionItem
        action={action}
        alwaysShowAction={hasCollapsedIndicators}
        itemKey={workspaceId}
        paddingBlock={4}
        paddingInline={4}
        title={
          <Tooltip title={rootPath}>
            <Flexbox
              horizontal
              align="center"
              data-testid="workspace-group"
              data-workspace-id={workspaceId}
              gap={8}
              height={24}
              style={{ overflow: 'hidden' }}
            >
              <Center flex={'none'} height={24} width={28}>
                <Icon
                  color={cssVar.colorTextTertiary}
                  icon={FolderIcon}
                  size={{ size: 15, strokeWidth: 1.5 }}
                />
              </Center>
              <Text ellipsis fontSize={14} style={{ color: cssVar.colorTextSecondary, flex: 1 }}>
                {title}
              </Text>
            </Flexbox>
          </Tooltip>
        }
      >
        <Flexbox gap={1} paddingBlock={1}>
          {topics.map((topic) => (
            <TopicItem
              active={activeTopicId === topic.id}
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              status={topic.status}
              threadId={activeThreadId}
              title={topic.title}
            />
          ))}
        </Flexbox>
      </AccordionItem>
    );
  },
);

WorkspaceGroupItem.displayName = 'WorkspaceGroupItem';

export default WorkspaceGroupItem;
