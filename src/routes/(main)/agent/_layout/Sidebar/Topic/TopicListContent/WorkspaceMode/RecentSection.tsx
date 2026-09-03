import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type TopicNavigationRecentEntry } from '@/store/projectWorkspace';

import TopicItem from '../../List/Item';

export interface RecentSectionProps {
  activeThreadId?: string;
  activeTopicId?: string;
  entries: TopicNavigationRecentEntry[];
}

/**
 * The fixed, flat "recent" list at the bottom of the Topic module. It is a
 * derived navigation list: unbound, scratch and project-less sandbox topics
 * only. Scratch rows carry a low-key temporary-directory tag.
 */
const RecentSection = memo<RecentSectionProps>(({ entries, activeTopicId, activeThreadId }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox data-testid="topic-recent-section" gap={1}>
      <Flexbox
        horizontal
        align="center"
        gap={4}
        height={28}
        paddingInline={'8px 4px'}
        style={{ overflow: 'hidden' }}
      >
        <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
          {t('workspaceRuntime.sidebar.recent' as any)}
        </Text>
        {entries.length > 0 && (
          <Text fontSize={11} type="secondary">
            {entries.length}
          </Text>
        )}
      </Flexbox>
      {entries.length === 0 ? (
        <Text
          fontSize={12}
          style={{ color: cssVar.colorTextQuaternary, paddingBlock: 4, paddingInline: 12 }}
        >
          {t('workspaceRuntime.sidebar.recentEmpty' as any)}
        </Text>
      ) : (
        <Flexbox gap={1} paddingBlock={1}>
          {entries.map(({ topic, placement, workspace }) => (
            <TopicItem
              active={activeTopicId === topic.id}
              fav={topic.favorite}
              id={topic.id}
              key={topic.id}
              metadata={topic.metadata}
              scratchWorkspace={
                placement.reason === 'scratch' && workspace?.rootPath
                  ? { rootPath: workspace.rootPath }
                  : undefined
              }
              status={topic.status}
              threadId={activeThreadId}
              title={topic.title}
            />
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

RecentSection.displayName = 'RecentSection';

export default RecentSection;
