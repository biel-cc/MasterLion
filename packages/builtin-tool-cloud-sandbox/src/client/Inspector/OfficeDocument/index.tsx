'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { OfficeToolState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  statusIcon: css`
    margin-block-end: -2px;
    margin-inline-start: 4px;
  `,
}));

interface OfficeDocumentArgs {
  outputPath?: string;
  path?: string;
  templatePath?: string;
}

export const OfficeDocumentInspector = memo<
  BuiltinInspectorProps<OfficeDocumentArgs, OfficeToolState>
>(({ args, partialArgs, isArgumentsStreaming, pluginState, isLoading }) => {
  const { t } = useTranslation('plugin');
  const path = args?.outputPath || args?.path || args?.templatePath || partialArgs?.path;

  return (
    <div
      className={cx(
        inspectorTextStyles.root,
        (isLoading || isArgumentsStreaming) && shinyTextStyles.shinyText,
      )}
    >
      <span>
        {t('builtins.lobe-cloud-sandbox.office.working', {
          defaultValue: 'Processing Office document: {{path}}',
          path: path || '',
        })}
      </span>
      {isLoading || isArgumentsStreaming ? null : pluginState?.success ? (
        <Check className={styles.statusIcon} color={cssVar.colorSuccess} size={14} />
      ) : (
        <X className={styles.statusIcon} color={cssVar.colorError} size={14} />
      )}
    </div>
  );
});

OfficeDocumentInspector.displayName = 'OfficeDocumentInspector';
