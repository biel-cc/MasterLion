'use client';

import { Block, Button, Checkbox, Empty, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { HeartHandshake, Undo2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getTelemetryMode } from '@/libs/telemetry/mode';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import LobeMessage from '../components/LobeMessage';
import OnboardingFooterActions from '../components/OnboardingFooterActions';

type DataMode = 'share' | 'privacy';

interface DataModeStepProps {
  onBack: () => void;
  onNext: () => void;
}

const DataModeStep = memo<DataModeStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');
  const telemetryMode = getTelemetryMode();
  const isManaged = telemetryMode !== 'optional';
  const telemetryEnabled = useUserStore(userGeneralSettingsSelectors.telemetry);
  const updateGeneralConfig = useUserStore((s) => s.updateGeneralConfig);
  const [selectedMode, setSelectedMode] = useState<DataMode>(
    telemetryMode === 'required'
      ? 'share'
      : telemetryMode === 'disabled'
        ? 'privacy'
        : telemetryEnabled
          ? 'share'
          : 'privacy',
  );

  const setMode = useCallback(
    (mode: DataMode) => {
      setSelectedMode(mode);
      const nextTelemetry = mode === 'share';
      if (telemetryEnabled !== nextTelemetry) {
        void updateGeneralConfig({ telemetry: nextTelemetry });
      }
    },
    [telemetryEnabled, updateGeneralConfig],
  );

  const checkIcon = (
    <Checkbox
      checked
      backgroundColor={cssVar.colorSuccess}
      shape={'circle'}
      size={20}
      style={{ position: 'absolute', right: 12, top: 12 }}
    />
  );

  return (
    <Flexbox gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox>
        <LobeMessage
          sentences={
            isManaged
              ? [t(`screen4.${telemetryMode}.heading`)]
              : [t('screen4.title'), t('screen4.title2'), t('screen4.title3')]
          }
        />
        <Text as={'p'}>
          {t(isManaged ? `screen4.${telemetryMode}.notice` : 'screen4.description')}
        </Text>
      </Flexbox>
      <Flexbox gap={16} style={{ width: '100%' }}>
        {/* Shared data option */}
        {telemetryMode !== 'disabled' && (
          <Block
            clickable={!isManaged}
            flex={1}
            gap={16}
            padding={16}
            style={{ borderColor: selectedMode === 'share' ? cssVar.colorSuccess : undefined }}
            variant={'outlined'}
            onClick={isManaged ? undefined : () => setMode('share')}
          >
            {(isManaged || selectedMode === 'share') && checkIcon}
            <Empty
              icon={HeartHandshake}
              padding={0}
              title={t(isManaged ? 'screen4.required.title' : 'screen4.share.title')}
              type={'page'}
              description={t(
                isManaged ? 'screen4.required.description' : 'screen4.share.description',
              )}
              descriptionProps={{
                fontSize: 14,
              }}
              titleProps={{
                fontSize: 18,
              }}
            />
            <Flexbox as={'ul'} gap={4} style={{ listStyle: 'none', padding: 0 }}>
              <li>
                <Text>• {t(isManaged ? 'screen4.required.items.1' : 'screen4.share.items.1')}</Text>
              </li>
              <li>
                <Text>• {t(isManaged ? 'screen4.required.items.2' : 'screen4.share.items.2')}</Text>
              </li>
              <li>
                <Text>• {t(isManaged ? 'screen4.required.items.3' : 'screen4.share.items.3')}</Text>
              </li>
            </Flexbox>
          </Block>
        )}

        {/* Privacy mode option */}
        {telemetryMode !== 'required' && (
          <Block
            clickable={!isManaged}
            flex={1}
            gap={6}
            padding={16}
            style={{ borderColor: selectedMode === 'privacy' ? cssVar.colorSuccess : undefined }}
            variant={'outlined'}
            onClick={isManaged ? undefined : () => setMode('privacy')}
          >
            {selectedMode === 'privacy' && checkIcon}
            <Text strong fontSize={18}>
              {t('screen4.privacy.title')}
            </Text>
            <Text fontSize={14} type={'secondary'}>
              {t('screen4.privacy.description')}
            </Text>
          </Block>
        )}
      </Flexbox>
      <Text color={cssVar.colorTextSecondary} fontSize={12} style={{ marginTop: 16 }}>
        {t(isManaged ? `screen4.${telemetryMode}.footerNote` : 'screen4.footerNote')}
      </Text>
      <OnboardingFooterActions
        left={
          <Button
            icon={Undo2Icon}
            style={{ color: cssVar.colorTextDescription }}
            type={'text'}
            onClick={onBack}
          >
            {t('back')}
          </Button>
        }
        right={
          <Button type={'primary'} onClick={onNext}>
            {t('next')}
          </Button>
        }
      />
    </Flexbox>
  );
});

DataModeStep.displayName = 'DataModeStep';

export default DataModeStep;
