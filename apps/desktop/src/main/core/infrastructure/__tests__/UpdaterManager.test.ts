import { autoUpdater } from 'electron-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyArtifact } from '@/modules/updater/artifactDownloader';
import { verifySignedManifest } from '@/modules/updater/signedManifest';
import { netFetch } from '@/utils/net-fetch';

import type { App as AppCore } from '../../App';
import { UpdaterManager } from '../UpdaterManager';

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  releaseSingleInstanceLock: vi.fn(),
  shellOpenPath: vi.fn(),
  storeGet: vi.fn(),
  storeSet: vi.fn(),
}));

vi.mock('electron-log', () => ({
  default: { transports: { file: { level: 'info' } } },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: 'stable',
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    forceDevUpdateConfig: false,
    logger: null,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock('builder-util-runtime', () => ({
  CancellationToken: class {
    cancel = vi.fn();
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('C:/updates'),
    getVersion: vi.fn().mockReturnValue('1.1.3'),
    releaseSingleInstanceLock: mocks.releaseSingleInstanceLock,
  },
  shell: { openPath: mocks.shellOpenPath },
}));

vi.mock('@/const/env', () => ({ isDev: false, isWindows: true }));
vi.mock('@/env', () => ({ getDesktopEnv: () => ({ FORCE_DEV_UPDATE_CONFIG: false }) }));
vi.mock('@/modules/updater/configs', () => ({
  resolveInitialUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
  UPDATE_CHANNEL: 'canary',
  UPDATE_SERVER_URL: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases',
  updaterConfig: {
    app: { autoCheckUpdate: false, checkUpdateInterval: 3_600_000 },
    enableAppUpdate: true,
  },
}));
vi.mock('@/utils/net-fetch', () => ({ netFetch: vi.fn() }));
vi.mock('@/modules/updater/artifactDownloader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/updater/artifactDownloader')>();
  return { ...actual, downloadArtifact: vi.fn(), verifyArtifact: vi.fn() };
});
vi.mock('@/modules/updater/signedManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/updater/signedManifest')>();
  return { ...actual, verifySignedManifest: vi.fn() };
});
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const artifact = {
  arch: 'x64' as const,
  path: 'canary/1.1.4/Masterino-1.1.4-setup.exe',
  platform: 'win32' as const,
  sha512: 'signed-sha512',
  size: 100,
};
const manifest = {
  artifacts: [artifact],
  channel: 'canary' as const,
  releaseDate: '2026-08-13T00:00:00.000Z',
  releaseNotes: 'Automatic update',
  version: '1.1.4',
};

describe('UpdaterManager signed OSS flow', () => {
  let manager: UpdaterManager;
  let events: Map<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    events = new Map();
    vi.mocked(autoUpdater.on).mockImplementation((name: string, handler: any) => {
      events.set(name, handler);
      return autoUpdater;
    });
    mocks.storeGet.mockImplementation((key: string) => (key === 'updateChannel' ? 'canary' : true));
    vi.mocked(netFetch).mockResolvedValue({
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({}),
      ok: true,
      status: 200,
      url: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/canary.json',
    } as any);
    vi.mocked(verifySignedManifest).mockReturnValue(manifest);
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({} as any);
    vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([
      'C:/updates/Masterino-1.1.4-setup.exe',
    ]);
    vi.mocked(verifyArtifact).mockResolvedValue(undefined);
    const app = {
      browserManager: {
        getMainWindow: () => ({
          broadcast: mocks.broadcast,
          webContents: { getURL: () => 'https://masterino.bielcrystal.com/' },
        }),
      },
      isQuiting: false,
      menuManager: { rebuildAppMenu: vi.fn() },
      storeManager: { get: mocks.storeGet, set: mocks.storeSet },
    } as unknown as AppCore;
    manager = new UpdaterManager(app);
  });

  it('checks the signed OSS manifest before configuring the immutable NSIS feed', async () => {
    await manager.initialize();
    await manager.checkForUpdates({ manual: true });

    expect(netFetch).toHaveBeenCalledWith(
      new URL(
        'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/canary.json',
      ),
      { redirect: 'manual' },
    );
    expect(verifySignedManifest).toHaveBeenCalled();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.4',
    });
  });

  it('automatically downloads and verifies the Windows installer', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    await events.get('update-available')?.({ version: '1.1.4' });
    await vi.waitFor(() =>
      expect(verifyArtifact).toHaveBeenCalledWith(expect.any(String), artifact),
    );
    expect(netFetch).toHaveBeenCalledWith(
      new URL(
        'https://masterlion-prd.oss-cn-shenzhen.aliyuncs.com/desktop/releases/canary/1.1.4/Masterino-1.1.4-setup.exe',
      ),
      { method: 'HEAD', redirect: 'manual' },
    );
    expect(manager.getUpdaterState()).toMatchObject({
      autoDownloadEnabled: true,
      installMode: 'restart',
      stage: 'downloaded',
    });
  });

  it('keeps the update available when automatic downloads are disabled', async () => {
    mocks.storeGet.mockImplementation((key: string) =>
      key === 'updateChannel' ? 'canary' : false,
    );
    await manager.initialize();
    await manager.checkForUpdates();
    await events.get('update-available')?.({ version: '1.1.4' });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(manager.getUpdaterState()).toMatchObject({
      autoDownloadEnabled: false,
      stage: 'available',
    });
  });

  it('cancels an active automatic download when disabled', async () => {
    let finishDownload!: (paths: string[]) => void;
    vi.mocked(autoUpdater.downloadUpdate).mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve;
      }),
    );
    await manager.initialize();
    await manager.checkForUpdates();
    events.get('update-available')?.({ version: '1.1.4' });
    await vi.waitFor(() => expect(manager.getUpdaterState().stage).toBe('downloading'));

    await manager.setAutoDownloadEnabled(false);
    finishDownload(['C:/updates/Masterino-1.1.4-setup.exe']);
    await vi.waitFor(() =>
      expect(manager.getUpdaterState()).toMatchObject({
        autoDownloadEnabled: false,
        stage: 'available',
      }),
    );
    expect(verifyArtifact).not.toHaveBeenCalled();
  });

  it('surfaces manifest verification failures without configuring a download feed', async () => {
    vi.mocked(verifySignedManifest).mockImplementation(() => {
      throw new Error('signature invalid');
    });
    await manager.initialize();
    await manager.checkForUpdates({ manual: true });
    expect(manager.getUpdaterState()).toMatchObject({ errorCode: 'unknown', stage: 'error' });
    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('rejects an artifact redirect before electron-updater downloads it', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    vi.mocked(netFetch).mockResolvedValueOnce({
      headers: new Headers(),
      ok: false,
      status: 302,
      url: 'https://example.com/update.exe',
    } as any);
    events.get('update-available')?.({ version: '1.1.4' });
    await vi.waitFor(() =>
      expect(manager.getUpdaterState()).toMatchObject({
        errorCode: 'signature',
        stage: 'error',
      }),
    );
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('enables install on quit only after a verified download', async () => {
    await manager.initialize();
    await manager.checkForUpdates();
    await events.get('update-available')?.({ version: '1.1.4' });
    await vi.waitFor(() => expect(manager.getUpdaterState().stage).toBe('downloaded'));
    manager.installLater();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(mocks.broadcast).toHaveBeenCalledWith('updateWillInstallLater');
  });
});
