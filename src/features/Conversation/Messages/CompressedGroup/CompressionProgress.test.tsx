/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CompressionProgress from './CompressionProgress';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('<CompressionProgress />', () => {
  afterEach(() => cleanup());

  it('announces the pending compression politely without blocking', () => {
    render(<CompressionProgress />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('compression.inProgress');
    expect(status).toHaveTextContent('compression.inProgressHint');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('can render the compact label only inside the compressed group header', () => {
    render(<CompressionProgress showHint={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('compression.inProgress');
    expect(screen.queryByText('compression.inProgressHint')).toBeNull();
  });
});
