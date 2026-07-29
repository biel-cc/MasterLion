'use client';

import { ActionIcon, Block } from '@lobehub/ui';
import { Download } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ImageItem from '@/components/ImageItem';

import { ActionButtons } from './ActionButtons';
import { styles } from './styles';
import { type SuccessStateProps } from './types';
import { getThumbnailMaxWidth } from './utils';

// Success state component
export const SuccessState = memo<SuccessStateProps>(
  ({
    generation,
    generationBatch,
    prompt,
    aspectRatio,
    onDelete,
    onDownload,
    onCopySeed,
    seedTooltip,
  }) => {
    const { t } = useTranslation('image');

    return (
      <Block
        align={'center'}
        className={styles.imageContainer}
        justify={'center'}
        variant={'filled'}
        style={{
          aspectRatio,
          maxWidth: getThumbnailMaxWidth(generation, generationBatch),
        }}
      >
        <ImageItem
          alt={prompt}
          style={{ height: '100%', width: '100%' }}
          // Thumbnail quality is too bad
          url={generation.asset!.url}
          preview={{
            actionsRender: (originalNode) => (
              <>
                {originalNode}
                <ActionIcon
                  icon={Download}
                  title={t('generation.actions.download')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownload();
                  }}
                />
              </>
            ),
            src: generation.asset!.url,
          }}
        />
        <ActionButtons
          showDownload
          seedTooltip={seedTooltip}
          showCopySeed={!!generation.seed}
          onCopySeed={onCopySeed}
          onDelete={onDelete}
          onDownload={onDownload}
        />
      </Block>
    );
  },
);

SuccessState.displayName = 'SuccessState';
