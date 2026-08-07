'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDiscoverStore } from '@/store/discover';
import { AssistantSorts, McpSorts, SkillSorts } from '@/types/discover';

import ListLoading from '../../components/ListLoading';
import Title from '../../components/Title';
import AssistantList from '../agent/features/List';
import McpList from '../mcp/features/List';
import SkillList from '../skill/features/List';
import CreatorRewardBanner from './features/CreatorRewardBanner';

const HomePage = memo(() => {
  const { t } = useTranslation('discover');
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const useMcpList = useDiscoverStore((s) => s.useFetchMcpList);
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);

  const { data: assistantList, isLoading: assistantLoading } = useAssistantList({
    page: 1,
    pageSize: 12,
    sort: AssistantSorts.Recommended,
  });

  const { data: skillList, isLoading: skillLoading } = useSkillList({
    page: 1,
    pageSize: 12,
    sort: SkillSorts.InstallCount,
  });

  const { data: mcpList, isLoading: mcpLoading } = useMcpList({
    page: 1,
    pageSize: 12,
    sort: McpSorts.Recommended,
  });

  return (
    <>
      <CreatorRewardBanner />
      <Title more={t('home.more')} moreLink={'/community/agent'}>
        {t('home.featuredAssistants')}
      </Title>
      {assistantLoading ? (
        <ListLoading length={8} rows={4} />
      ) : (
        <AssistantList data={assistantList?.items} rows={4} />
      )}
      <div />
      <Title more={t('home.more')} moreLink={'/community/skill'}>
        {t('home.featuredSkills')}
      </Title>
      {skillLoading ? (
        <ListLoading length={8} rows={4} />
      ) : (
        <SkillList data={skillList?.items} rows={4} />
      )}
      <div />
      <Title more={t('home.more')} moreLink={'/community/mcp'}>
        {t('home.featuredTools')}
      </Title>
      {mcpLoading ? (
        <ListLoading length={8} rows={4} />
      ) : (
        <McpList data={mcpList?.items} rows={4} />
      )}
    </>
  );
});

export default HomePage;
