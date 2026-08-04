import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateNotification } from './UpdateNotification';

type Handler = (payload: any) => void;

const mocks = vi.hoisted(() => ({
  getUpdaterState: vi.fn(),
  handlers: new Map<string, Handler>(),
  installNow: vi.fn(),
  openExternalLink: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: Handler) => {
    mocks.handlers.set(event, handler);
  },
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => ({
  Modal: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ container: 'container', releaseNote: 'releaseNote' }),
  cssVar: {
    boxShadow: 'none',
    colorBgElevated: 'transparent',
    colorBorderSecondary: 'transparent',
    colorFillQuaternary: 'transparent',
    colorText: 'inherit',
    colorTextSecondary: 'inherit',
  },
}));

vi.mock('lucide-react', () => ({ CircleFadingArrowUp: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/electron/autoUpdate', () => ({
  autoUpdateService: {
    getUpdaterState: mocks.getUpdaterState,
    installNow: mocks.installNow,
  },
}));

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: mocks.openExternalLink },
}));

const emitUpdaterState = (payload: any) => {
  act(() => mocks.handlers.get('updaterStateChanged')?.(payload));
};

describe('UpdateNotification', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.getUpdaterState.mockReset().mockResolvedValue({ stage: 'idle' });
    mocks.installNow.mockReset();
    mocks.openExternalLink.mockReset().mockResolvedValue(undefined);
  });

  it('shows release details and opens the platform installer URL', async () => {
    render(<UpdateNotification />);

    emitUpdaterState({
      downloadUrl: 'https://example.com/Masterino-1.1.2-arm64.dmg',
      stage: 'available',
      updateInfo: { releaseNotes: 'Important fixes', version: '1.1.2' },
    });

    expect(screen.getByText(/1\.1\.2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/1\.1\.2/));
    expect(screen.getByText('Important fixes')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('updater.downloadNewVersion')[0]);

    await waitFor(() => {
      expect(mocks.openExternalLink).toHaveBeenCalledWith(
        'https://example.com/Masterino-1.1.2-arm64.dmg',
      );
    });
    expect(mocks.installNow).not.toHaveBeenCalled();
  });

  it('dismisses only the current prompt', () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      downloadUrl: 'https://example.com/Masterino-1.1.2-setup.exe',
      stage: 'available',
      updateInfo: { version: '1.1.2' },
    });

    fireEvent.click(screen.getByText('updater.later'));

    expect(screen.queryByText('updater.newVersionAvailable')).not.toBeInTheDocument();
    expect(mocks.openExternalLink).not.toHaveBeenCalled();
  });
});
