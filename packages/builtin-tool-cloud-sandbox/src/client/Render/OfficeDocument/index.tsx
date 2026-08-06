'use client';

import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { OfficeToolState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  statusIcon: css`
    font-size: 12px;
  `,
}));

interface OfficeDocumentArgs {
  outputPath?: string;
  path?: string;
  templatePath?: string;
}

const OfficeDocument = memo<BuiltinRenderProps<OfficeDocumentArgs, OfficeToolState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const path = pluginState?.path || args.outputPath || args.path || args.templatePath;

    return (
      <Flexbox className={styles.container} gap={6}>
        <Flexbox horizontal align={'center'} gap={8}>
          {pluginState === undefined ? null : pluginState.success ? (
            <CheckCircleFilled
              className={styles.statusIcon}
              style={{ color: cssVar.colorSuccess }}
            />
          ) : (
            <CloseCircleFilled className={styles.statusIcon} style={{ color: cssVar.colorError }} />
          )}
          <Text code as={'span'} fontSize={12}>
            {pluginState?.success
              ? t('builtins.lobe-cloud-sandbox.office.success', {
                  defaultValue: 'Office document ready: {{path}}',
                  path: path || '',
                })
              : t('builtins.lobe-cloud-sandbox.office.failed', {
                  defaultValue: 'Office operation failed: {{path}}',
                  path: path || '',
                })}
          </Text>
        </Flexbox>
        {pluginState?.issues && pluginState.issues.length > 0 && (
          <Text fontSize={12} style={{ paddingInlineStart: 20 }} type={'warning'}>
            {t('builtins.lobe-cloud-sandbox.office.issues', {
              count: pluginState.issues.length,
              defaultValue: 'Found {{count}} document issues',
            })}
          </Text>
        )}
        {pluginState?.error?.message && (
          <Text fontSize={12} style={{ paddingInlineStart: 20 }} type={'secondary'}>
            {pluginState.error.message}
          </Text>
        )}
      </Flexbox>
    );
  },
);

OfficeDocument.displayName = 'OfficeDocument';

export default OfficeDocument;
