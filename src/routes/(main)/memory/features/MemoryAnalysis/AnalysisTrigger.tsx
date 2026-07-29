'use client';

import { ActionIcon, Button, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { CalendarClockIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useMemoryAnalysisAsyncTask } from '@/routes/(main)/memory/features/MemoryAnalysis/useTask';
import { memoryExtractionService } from '@/services/userMemory/extraction';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import DateRangeModal from './DateRangeModal';

interface Props {
  footerNote: string;
  iconOnly?: boolean;
  onRangeChange: (range: [Date | null, Date | null]) => void;
  range: [Date | null, Date | null];
}

const AnalysisTrigger = memo<Props>(({ footerNote, range, onRangeChange, iconOnly }) => {
  const { t } = useTranslation('memory');
  const { message } = App.useApp();
  const { isValidating, refresh } = useMemoryAnalysisAsyncTask();
  const memoryEnabled = useUserStore(settingsSelectors.memoryEnabled);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!memoryEnabled) {
      message.warning(t('analysis.action.enableFirst'));
      return;
    }

    setSubmitting(true);
    try {
      const [from, to] = range;
      const result = await memoryExtractionService.requestFromChatTopics({
        fromDate: from ?? undefined,
        toDate: to ?? undefined,
      });

      await refresh();
      message.success(result.deduped ? t('analysis.toast.deduped') : t('analysis.toast.started'));

      setOpen(false);
    } catch (error) {
      console.error(error);
      message.error(t('analysis.toast.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const loading = submitting || isValidating;
  const tooltip = t(memoryEnabled ? 'analysis.action.button' : 'analysis.action.enableFirst');

  return (
    <>
      {iconOnly ? (
        <Tooltip title={tooltip}>
          <ActionIcon
            disabled={!memoryEnabled}
            icon={CalendarClockIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            tooltipProps={{ placement: 'bottom' }}
            onClick={() => memoryEnabled && setOpen(true)}
          />
        </Tooltip>
      ) : (
        <Tooltip title={!memoryEnabled ? tooltip : undefined}>
          <Button
            className="test"
            disabled={!memoryEnabled}
            icon={CalendarClockIcon}
            loading={loading}
            size={'small'}
            style={{ maxWidth: 300 }}
            type={'primary'}
            onClick={() => setOpen(true)}
          >
            {t('analysis.action.button')}
          </Button>
        </Tooltip>
      )}

      <DateRangeModal
        footerNote={footerNote}
        open={open}
        range={range}
        submitting={submitting}
        onCancel={() => setOpen(false)}
        onChange={onRangeChange}
        onSubmit={handleSubmit}
      />
    </>
  );
});

AnalysisTrigger.displayName = 'AnalysisTrigger';

export default AnalysisTrigger;
