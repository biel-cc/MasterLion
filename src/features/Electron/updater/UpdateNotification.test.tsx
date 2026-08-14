import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateNotification } from './UpdateNotification';

type Handler = (payload: any) => void;

const mocks = vi.hoisted(() => ({
  applyDownloadedUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  getUpdaterState: vi.fn(),
  handlers: new Map<string, Handler>(),
  checkUpdate: vi.fn(),
  installLater: vi.fn(),
  installNow: vi.fn(),
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
    applyDownloadedUpdate: mocks.applyDownloadedUpdate,
    checkUpdate: mocks.checkUpdate,
    downloadUpdate: mocks.downloadUpdate,
    getUpdaterState: mocks.getUpdaterState,
    installNow: mocks.installNow,
    installLater: mocks.installLater,
  },
}));

const emitUpdaterState = (payload: any) => {
  act(() => mocks.handlers.get('updaterStateChanged')?.(payload));
};

describe('UpdateNotification', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.applyDownloadedUpdate.mockReset();
    mocks.checkUpdate.mockReset();
    mocks.downloadUpdate.mockReset().mockResolvedValue(undefined);
    mocks.getUpdaterState
      .mockReset()
      .mockResolvedValue({ autoDownloadEnabled: true, stage: 'idle' });
    mocks.installNow.mockReset();
    mocks.installLater.mockReset();
  });

  it('shows release details and starts a main-process download', async () => {
    render(<UpdateNotification />);

    emitUpdaterState({
      autoDownloadEnabled: false,
      installMode: 'open-dmg',
      stage: 'available',
      updateInfo: { releaseNotes: 'Important fixes', version: '1.1.2' },
    });

    expect(screen.getByText(/1\.1\.2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/1\.1\.2/));
    expect(screen.getByText('Important fixes')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('updater.downloadNewVersion')[0]);

    await waitFor(() => {
      expect(mocks.downloadUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.installNow).not.toHaveBeenCalled();
  });

  it('opens a verified macOS installer after download', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: true,
      installMode: 'open-dmg',
      stage: 'downloaded',
      updateInfo: { version: '1.1.4' },
    });

    fireEvent.click(screen.getByText('updater.openInstaller'));
    await waitFor(() => expect(mocks.applyDownloadedUpdate).toHaveBeenCalledTimes(1));
  });

  it('dismisses only the current prompt', () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: false,
      stage: 'available',
      updateInfo: { version: '1.1.2' },
    });

    fireEvent.click(screen.getByText('updater.later'));

    expect(screen.queryByText('updater.newVersionAvailable')).not.toBeInTheDocument();
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
  });

  it('offers install on exit for a verified Windows update', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({
      autoDownloadEnabled: true,
      installMode: 'restart',
      stage: 'downloaded',
      updateInfo: { version: '1.1.4' },
    });

    fireEvent.click(screen.getByText('updater.installLater'));
    await waitFor(() => expect(mocks.installLater).toHaveBeenCalledTimes(1));
  });

  it('shows a localized error and retries a failed check', async () => {
    render(<UpdateNotification />);
    emitUpdaterState({ autoDownloadEnabled: true, errorCode: 'signature', stage: 'error' });

    expect(screen.getByText('updater.error.signature')).toBeInTheDocument();
    fireEvent.click(screen.getByText('updater.retry'));
    await waitFor(() => expect(mocks.checkUpdate).toHaveBeenCalledTimes(1));
  });
});
