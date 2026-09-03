'use client';

import TopicItemFeature, {
  type TopicItemProps as TopicItemFeatureProps,
} from '@/features/AgentTopicSidebar/TopicItem';

import ThreadList from '../../TopicListContent/ThreadList';

export type TopicItemProps = Omit<TopicItemFeatureProps, 'ThreadListComponent'>;

/** Thin route adapter: route-owned nested thread UI is injected into the topic feature. */
const TopicItem = (props: TopicItemProps) => (
  <TopicItemFeature {...props} ThreadListComponent={ThreadList} />
);

export default TopicItem;
