'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Alert, Descriptions } from 'antd';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

export interface ViewCredModalContentProps {
  cred: UserCredSummary;
}

const ViewCredModalContent: FC<ViewCredModalContentProps> = ({ cred }) => {
  const { t } = useTranslation('setting');

  return (
    <>
      <Descriptions bordered column={1} size={'small'}>
        <Descriptions.Item label={t('creds.table.name')}>{cred.name}</Descriptions.Item>
        <Descriptions.Item label={t('creds.table.key')}>
          <code>{cred.key}</code>
        </Descriptions.Item>
        <Descriptions.Item label={t('creds.table.type')}>
          {cred.type ? t(`creds.types.${cred.type}` as any) : '-'}
        </Descriptions.Item>
      </Descriptions>
      <Alert
        showIcon
        description={t('creds.view.serverOnlyDescription')}
        message={t('creds.view.serverOnly')}
        style={{ marginTop: 16 }}
        type={'info'}
      />
    </>
  );
};

export default ViewCredModalContent;
