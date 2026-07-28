import { render, screen } from '@testing-library/react';
import type { ImgHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';

import { SuccessState } from './SuccessState';

const mockImage = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');

  return {
    ActionIcon: () => null,
    Block: ({ children }: { children?: ReactNode }) => React.createElement('div', null, children),
    Image: ({ alt, crossOrigin, src }: ImgHTMLAttributes<HTMLImageElement>) => {
      mockImage({ alt, crossOrigin, src });

      return React.createElement('img', {
        alt,
        crossOrigin,
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

  it('loads generated images anonymously so preview downloads can reuse a CORS-safe response', () => {
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

    expect(screen.getByTestId('generated-image')).toHaveAttribute('crossorigin', 'anonymous');
    expect(mockImage).toHaveBeenCalledWith(
      expect.objectContaining({
        crossOrigin: 'anonymous',
        src: 'https://assets.example.com/generated.png',
      }),
    );
  });
});
