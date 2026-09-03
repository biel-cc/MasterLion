'use client';

import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { LoaderCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles/loading';

/** Loose `t`: `compression.inProgress*` keys live in `locales/{en-US,zh-CN}/chat.json`. */
type LooseT = (key: string) => string;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;

    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  hint: css`
    flex-basis: 100%;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-weight: 500;
  `,
}));

export interface CompressionProgressProps {
  className?: string;
  /** Show the one-line explanation under the label; off inside the compressed group header. */
  showHint?: boolean;
}

/**
 * Non-blocking "Compressing context" progress. Announced politely to assistive technology and
 * rendered instead of any terminal error while automatic compression is still running.
 */
const CompressionProgress = memo<CompressionProgressProps>(({ className, showHint = true }) => {
  const { t } = useTranslation('chat');
  const tr = t as unknown as LooseT;

  return (
    <div
      aria-busy={'true'}
      aria-live={'polite'}
      className={cx(styles.container, className)}
      role={'status'}
    >
      <Icon aria-hidden spin icon={LoaderCircle} size={14} />
      <span className={cx(styles.label, shinyTextStyles.shinyText)}>
        {tr('compression.inProgress')}
      </span>
      {showHint && <span className={styles.hint}>{tr('compression.inProgressHint')}</span>}
    </div>
  );
});

CompressionProgress.displayName = 'CompressionProgress';

export default CompressionProgress;
