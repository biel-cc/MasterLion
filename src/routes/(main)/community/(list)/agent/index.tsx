'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Navigate } from 'react-router-dom';

import SafeBoundary, { AlertFallback } from '@/components/ErrorBoundary';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type AssistantQueryParams } from '@/types/discover';
import {
  AssistantCategory,
  AssistantSorts,
  DiscoverTab,
  isPublicAssistantCategory,
} from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const AssistantListPage = memo(() => {
  const { q, page, category, sort, order, source } = useQuery() as AssistantQueryParams;
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, error, isLoading, mutate } = useAssistantList({
    category,
    includeAgentGroup: true,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? AssistantSorts.Recommended,
    source,
  });

  if (error) {
    return <AlertFallback error={error} resetErrorBoundary={() => void mutate()} />;
  }
  if (isLoading || !data) return <Loading />;

  const { items, currentPage, pageSize, totalCount } = data;

  return (
    <Flexbox gap={32} width={'100%'}>
      <SafeBoundary minHeight={240} variant="alert">
        <List data={items} />
      </SafeBoundary>
      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        tab={DiscoverTab.Assistants}
        total={totalCount}
      />
    </Flexbox>
  );
});

const AssistantPage = memo(() => {
  const { category } = useQuery() as AssistantQueryParams;
  const isSystemCategory = [AssistantCategory.All, AssistantCategory.Discover].includes(
    category as AssistantCategory,
  );

  if (category && !isSystemCategory && !isPublicAssistantCategory(category)) {
    return <Navigate replace to="/community/agent" />;
  }

  return <AssistantListPage />;
});

export default AssistantPage;
