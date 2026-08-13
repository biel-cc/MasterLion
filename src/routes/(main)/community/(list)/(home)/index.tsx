'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SafeBoundary, { AlertFallback } from '@/components/ErrorBoundary';
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

  const {
    data: assistantList,
    error: assistantError,
    isLoading: assistantLoading,
    mutate: retryAssistants,
  } = useAssistantList({
    page: 1,
    pageSize: 12,
    sort: AssistantSorts.Recommended,
  });

  const {
    data: skillList,
    error: skillError,
    isLoading: skillLoading,
    mutate: retrySkills,
  } = useSkillList({
    page: 1,
    pageSize: 12,
    sort: SkillSorts.InstallCount,
  });

  const {
    data: mcpList,
    error: mcpError,
    isLoading: mcpLoading,
    mutate: retryMcp,
  } = useMcpList({
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
      <SafeBoundary alertTitle={t('home.featuredAssistants')} minHeight={160} variant="alert">
        {assistantError ? (
          <AlertFallback
            error={assistantError}
            resetErrorBoundary={() => void retryAssistants()}
            title={t('home.featuredAssistants')}
          />
        ) : assistantLoading ? (
          <ListLoading length={8} rows={4} />
        ) : (
          <AssistantList data={assistantList?.items} rows={4} />
        )}
      </SafeBoundary>
      <div />
      <Title more={t('home.more')} moreLink={'/community/skill'}>
        {t('home.featuredSkills')}
      </Title>
      <SafeBoundary alertTitle={t('home.featuredSkills')} minHeight={160} variant="alert">
        {skillError ? (
          <AlertFallback
            error={skillError}
            resetErrorBoundary={() => void retrySkills()}
            title={t('home.featuredSkills')}
          />
        ) : skillLoading ? (
          <ListLoading length={8} rows={4} />
        ) : (
          <SkillList data={skillList?.items} rows={4} />
        )}
      </SafeBoundary>
      <div />
      <Title more={t('home.more')} moreLink={'/community/mcp'}>
        {t('home.featuredTools')}
      </Title>
      <SafeBoundary alertTitle={t('home.featuredTools')} minHeight={160} variant="alert">
        {mcpError ? (
          <AlertFallback
            error={mcpError}
            resetErrorBoundary={() => void retryMcp()}
            title={t('home.featuredTools')}
          />
        ) : mcpLoading ? (
          <ListLoading length={8} rows={4} />
        ) : (
          <McpList data={mcpList?.items} rows={4} />
        )}
      </SafeBoundary>
    </>
  );
});

export default HomePage;
