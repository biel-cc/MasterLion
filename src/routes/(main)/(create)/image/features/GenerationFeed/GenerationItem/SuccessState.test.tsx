import { fireEvent, render, screen } from '@testing-library/react';
import type { ImgHTMLAttributes, MouseEventHandler, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';

import { SuccessState } from './SuccessState';

const mockImage = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');

  return {
    ActionIcon: ({
      onClick,
      title,
    }: {
      onClick?: MouseEventHandler<HTMLButtonElement>;
      title?: string;
    }) => React.createElement('button', { 'aria-label': title, onClick }),
    Block: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
    Image: ({
      alt,
      preview,
      src,
    }: ImgHTMLAttributes<HTMLImageElement> & {
      preview?: { actionsRender?: (originalNode: ReactNode) => ReactNode };
    }) => {
      mockImage({ alt, preview, src });

      return React.createElement('img', {
        alt,
        'data-testid': 'generated-image',
        src,
      });
    },
  };
});

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    deleteButton: 'delete-button',
    editableImage: 'editable-image',
    image: 'image',
  }),
  cssVar: {
    colorBgContainer: 'var(--color-bg-container)',
    colorBgMask: 'var(--color-bg-mask)',
    colorError: 'var(--color-error)',
    colorFill: 'var(--color-fill)',
  },
  cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
}));

vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ isSafari: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./ActionButtons', () => ({
  ActionButtons: () => null,
}));

vi.mock('./styles', () => ({
  styles: {
    imageContainer: 'image-container',
  },
}));

vi.mock('./utils', () => ({
  getThumbnailMaxWidth: () => 200,
}));

describe('SuccessState', () => {
  const generationBatch: GenerationBatch = {
    createdAt: new Date(),
    generations: [],
    id: 'batch-id',
    model: 'gpt-image-2',
    prompt: 'test prompt',
    provider: 'lobehub',
  };

  it('does not require CORS mode to render generated images', () => {
    const generation: Generation = {
      asset: {
        type: 'image',
        url: 'https://assets.example.com/generated.png',
      },
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        id: 'task-id',
        status: AsyncTaskStatus.Success,
      },
    };

    render(
      <SuccessState
        aspectRatio="1 / 1"
        generation={generation}
        generationBatch={generationBatch}
        prompt="test prompt"
        onDelete={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByTestId('generated-image')).not.toHaveAttribute('crossorigin');
    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'https://assets.example.com/generated.png',
      }),
    );
  });

  it('uses the generation download handler in the full-screen preview', () => {
    const onDownload = vi.fn();
    const generation: Generation = {
      asset: {
        type: 'image',
        url: 'https://assets.example.com/generated.png',
      },
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        id: 'task-id',
        status: AsyncTaskStatus.Success,
      },
    };

    render(
      <SuccessState
        aspectRatio="1 / 1"
        generation={generation}
        generationBatch={generationBatch}
        prompt="test prompt"
        onDelete={vi.fn()}
        onDownload={onDownload}
      />,
    );

    const preview = mockImage.mock.lastCall?.[0].preview;
    render(preview.actionsRender(<span>default preview actions</span>));
    fireEvent.click(screen.getByRole('button', { name: 'generation.actions.download' }));

    expect(onDownload).toHaveBeenCalledOnce();
    expect(screen.getByText('default preview actions')).toBeInTheDocument();
  });
});
