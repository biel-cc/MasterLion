'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SafeBoundary, { AlertFallback } from '@/components/ErrorBoundary';
import { useQuery } from '@/hooks/useQuery';
import { useDiscoverStore } from '@/store/discover';
import { type SkillQueryParams } from '@/types/discover';
import { DiscoverTab, SkillSorts } from '@/types/discover';

import Pagination from '../features/Pagination';
import List from './features/List';
import Loading from './loading';

const SkillPage = memo(() => {
  const { q, page, category, sort, order } = useQuery() as SkillQueryParams;
  const useSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const { data, error, isLoading, mutate } = useSkillList({
    category,
    order,
    page,
    pageSize: 21,
    q,
    sort: sort ?? SkillSorts.InstallCount,
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
        tab={DiscoverTab.Skills}
        total={totalCount}
      />
    </Flexbox>
  );
});

export default SkillPage;
