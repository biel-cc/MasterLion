'use client';

import { Alert, Button, Center, Empty, Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { BookOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { useChatStore } from '@/store/chat';

import DocumentItem from './DocumentItem';

const NotebookBody = memo(() => {
  const { t } = useTranslation(['portal', 'common']);
  const topicId = useChatStore((s) => s.activeTopicId);
  const { documents, error, isLoading, isValidating, refresh } =
    useFetchNotebookDocuments(topicId);

  const errorAlert = error ? (
    <Alert
      showIcon
      title={t('notebook.loadError')}
      type={'error'}
      variant={'borderless'}
      action={
        <Button loading={isValidating} size={'small'} onClick={() => void refresh()}>
          {t('common:retry')}
        </Button>
      }
    />
  ) : null;

  // Show message when no topic is selected
  if (!topicId) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('notebook.empty')} icon={BookOpenIcon} />
      </Center>
    );
  }

  // Show loading state
  if (isLoading && documents.length === 0) {
    return (
      <Center flex={1}>
        <Spin />
      </Center>
    );
  }

  if (error && documents.length === 0) {
    return (
      <Center flex={1} padding={16}>
        {errorAlert}
      </Center>
    );
  }

  // Show empty state
  if (documents.length === 0) {
    return (
      <Center flex={1} gap={8} paddingBlock={24}>
        <Empty description={t('notebook.empty')} icon={BookOpenIcon} />
      </Center>
    );
  }

  // Render document list
  return (
    <Flexbox gap={8} height={'100%'} paddingInline={12} style={{ overflow: 'auto' }}>
      {errorAlert}
      {documents.map((doc) => (
        <DocumentItem document={doc} key={doc.id} topicId={topicId} />
      ))}
    </Flexbox>
  );
});

export default NotebookBody;
