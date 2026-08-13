import path from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';

import type {
  ProgressInfo,
  UpdateChannel,
  UpdateInfo,
  UpdaterErrorCode,
  UpdaterInstallMode,
  UpdaterStage,
  UpdaterState,
} from '@lobechat/electron-client-ipc';
import { CancellationToken } from 'builder-util-runtime';
import { app as electronApp, shell } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import semver from 'semver';

import { isDev, isWindows } from '@/const/env';
import { getDesktopEnv } from '@/env';
import {
  downloadArtifact,
  ArtifactDownloadError,
  verifyArtifact,
} from '@/modules/updater/artifactDownloader';
import {
  resolveInitialUpdateChannel,
  UPDATE_CHANNEL,
  UPDATE_SERVER_URL,
  updaterConfig,
} from '@/modules/updater/configs';
import {
  type DesktopUpdateArtifact,
  type DesktopUpdateManifest,
  selectUpdateArtifact,
  SignedManifestError,
  verifySignedManifest,
} from '@/modules/updater/signedManifest';
import { extractRestoreRoute } from '@/modules/updater/utils';
import { netFetch } from '@/utils/net-fetch';
import { createLogger } from '@/utils/logger';

import type { App as AppCore } from '../App';

const FORCE_DEV_UPDATE_CONFIG = getDesktopEnv().FORCE_DEV_UPDATE_CONFIG;
const logger = createLogger('core:UpdaterManager');

export class UpdaterManager {
  private activeGeneration = 0;
  private app: AppCore;
  private autoDownloadEnabled = true;
  private checkGeneration = 0;
  private checking = false;
  private currentChannel: UpdateChannel = UPDATE_CHANNEL;
  private downloadAbortController: AbortController | null = null;
  private downloadCancellationToken: CancellationToken | null = null;
  private downloadedArtifactPath: string | null = null;
  private downloading = false;
  private installMode: UpdaterInstallMode | null = null;
  private latestError: string | null = null;
  private latestErrorCode: UpdaterErrorCode | null = null;
  private latestProgress: ProgressInfo | null = null;
  private latestUpdateInfo: UpdateInfo | null = null;
  private pendingArtifact: DesktopUpdateArtifact | null = null;
  private pendingManifest: DesktopUpdateManifest | null = null;
  private pendingRecheck = false;
  private stage: UpdaterStage = 'idle';
  private updateAvailable = false;

  constructor(app: AppCore) {
    this.app = app;
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
  }

  get mainWindow() {
    return this.app.browserManager.getMainWindow();
  }

  public getUpdaterState(): UpdaterState {
    const state: UpdaterState = {
      autoDownloadEnabled: this.autoDownloadEnabled,
      stage: this.stage,
    };
    if (this.installMode) state.installMode = this.installMode;
    if (this.latestProgress) state.progress = this.latestProgress;
    if (this.latestUpdateInfo) state.updateInfo = this.latestUpdateInfo;
    if (this.latestError) state.errorMessage = this.latestError;
    if (this.latestErrorCode) state.errorCode = this.latestErrorCode;
    return state;
  }

  private setStage(
    stage: UpdaterStage,
    opts?: {
      error?: string;
      errorCode?: UpdaterErrorCode;
      installMode?: UpdaterInstallMode;
      progress?: ProgressInfo;
      rebuildMenu?: boolean;
      updateInfo?: UpdateInfo;
    },
  ) {
    this.stage = stage;
    if (opts?.updateInfo !== undefined) this.latestUpdateInfo = opts.updateInfo;
    if (opts?.progress !== undefined) this.latestProgress = opts.progress;
    if (opts?.installMode !== undefined) this.installMode = opts.installMode;
    if (opts?.error !== undefined) this.latestError = opts.error;
    if (opts?.errorCode !== undefined) this.latestErrorCode = opts.errorCode;
    if (stage === 'idle' || stage === 'checking') this.latestProgress = null;
    if (stage === 'checking') this.latestUpdateInfo = null;
    if (stage !== 'error') {
      this.latestError = null;
      this.latestErrorCode = null;
    }
    this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
    if (opts?.rebuildMenu !== false) this.app.menuManager.rebuildAppMenu();
  }

  public initialize = async () => {
    if (!updaterConfig.enableAppUpdate) return;
    const storedChannel = this.app.storeManager.get('updateChannel');
    this.currentChannel = resolveInitialUpdateChannel(storedChannel);
    if (storedChannel !== this.currentChannel)
      this.app.storeManager.set('updateChannel', this.currentChannel);
    this.autoDownloadEnabled = this.app.storeManager.get('autoDownloadUpdates') ?? true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = this.currentChannel !== 'stable';
    autoUpdater.forceDevUpdateConfig = Boolean(isDev || FORCE_DEV_UPDATE_CONFIG);
    this.registerEvents();
    void this.cleanupUpdateCache();
    if (updaterConfig.app.autoCheckUpdate) {
      setTimeout(() => void this.checkForUpdates(), 60_000);
      setInterval(() => void this.checkForUpdates(), updaterConfig.app.checkUpdateInterval);
    }
  };

  public setAutoDownloadEnabled = async (enabled: boolean) => {
    this.autoDownloadEnabled = enabled;
    if (!enabled && this.downloading) {
      this.downloadAbortController?.abort();
      this.downloadCancellationToken?.cancel();
      this.setStage('available');
    } else if (enabled && this.stage === 'available') {
      await this.downloadUpdate();
    } else {
      this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
    }
  };

  public switchChannel = (channel: UpdateChannel) => {
    this.currentChannel = channel;
    this.checkGeneration++;
    this.downloadAbortController?.abort();
    this.downloadCancellationToken?.cancel();
    this.resetPendingUpdate();
    this.mainWindow.broadcast('updateChannelChanged', channel);
    if (this.checking) this.pendingRecheck = true;
    else void this.checkForUpdates();
  };

  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.checking || this.downloading) return;
    if (!UPDATE_SERVER_URL) {
      if (manual) this.fail('Update server is not configured', 'network');
      return;
    }
    this.checking = true;
    this.activeGeneration = this.checkGeneration;
    this.setStage('checking');
    logger.info(`${manual ? 'Manual' : 'Automatic'} signed OSS update check`);
    try {
      const manifest = await this.fetchSignedManifest();
      if (this.isStaleCheck()) return;
      const currentVersion = electronApp.getVersion();
      if (!semver.gt(manifest.version, currentVersion)) {
        this.resetPendingUpdate();
        this.setStage('latest', { updateInfo: this.toUpdateInfo(manifest) });
        return;
      }
      const artifact = selectUpdateArtifact(manifest, process.platform, process.arch);
      if (!artifact)
        throw new SignedManifestError('No signed artifact for this platform', 'signature');
      this.pendingManifest = manifest;
      this.pendingArtifact = artifact;
      this.updateAvailable = true;
      this.installMode = isWindows ? 'restart' : 'open-dmg';
      this.setStage('available', {
        installMode: this.installMode,
        updateInfo: this.toUpdateInfo(manifest),
      });

      if (isWindows) {
        this.configureWindowsProvider(manifest.version);
        await autoUpdater.checkForUpdates();
      } else if (this.autoDownloadEnabled) {
        await this.downloadUpdate();
      }
    } catch (error) {
      if (!this.isStaleCheck()) this.handleError(error);
    } finally {
      this.checking = false;
      if (this.pendingRecheck) {
        this.pendingRecheck = false;
        void this.checkForUpdates();
      }
    }
  };

  public downloadUpdate = async () => {
    if (this.downloading || !this.updateAvailable || !this.pendingArtifact || !this.pendingManifest)
      return;
    this.downloading = true;
    this.downloadAbortController = new AbortController();
    this.downloadCancellationToken = new CancellationToken();
    this.setStage('downloading');
    let windowsInstallerPath: string | undefined;
    try {
      if (isWindows) {
        await this.verifyArtifactEndpoint(this.pendingArtifact);
        const paths = await autoUpdater.downloadUpdate(this.downloadCancellationToken);
        if (this.downloadAbortController.signal.aborted) {
          throw new DOMException('Update download cancelled', 'AbortError');
        }
        windowsInstallerPath =
          paths.find((item: string) => item.toLowerCase().endsWith('.exe')) ?? paths[0];
        if (!windowsInstallerPath)
          throw new ArtifactDownloadError('Updater did not return an installer', 'integrity');
        await verifyArtifact(windowsInstallerPath, this.pendingArtifact);
        if (this.downloadAbortController.signal.aborted) {
          throw new DOMException('Update download cancelled', 'AbortError');
        }
        this.downloadedArtifactPath = windowsInstallerPath;
      } else {
        const cacheDir = path.join(
          electronApp.getPath('userData'),
          'updates',
          this.currentChannel,
          this.pendingManifest.version,
        );
        this.downloadedArtifactPath = await downloadArtifact({
          artifact: this.pendingArtifact,
          baseUrl: UPDATE_SERVER_URL!,
          destinationDir: cacheDir,
          onProgress: (progress) => this.onDownloadProgress(progress),
          signal: this.downloadAbortController.signal,
        });
      }
      this.downloading = false;
      this.downloadAbortController = null;
      this.downloadCancellationToken = null;
      this.setStage('downloaded', {
        installMode: this.installMode!,
        updateInfo: this.toUpdateInfo(this.pendingManifest),
      });
      this.mainWindow.broadcast('updateDownloaded', this.toUpdateInfo(this.pendingManifest));
    } catch (error) {
      this.downloading = false;
      this.downloadAbortController = null;
      this.downloadCancellationToken = null;
      if (['AbortError', 'CancellationError'].includes((error as Error)?.name)) {
        this.setStage('available');
        return;
      }
      if (
        windowsInstallerPath &&
        error instanceof ArtifactDownloadError &&
        error.code === 'integrity'
      ) {
        await rm(windowsInstallerPath, { force: true }).catch(() => undefined);
      }
      this.handleError(error);
    }
  };

  public applyDownloadedUpdate = () => {
    if (this.stage !== 'downloaded' || !this.downloadedArtifactPath) return;
    if (this.installMode === 'open-dmg') {
      void shell.openPath(this.downloadedArtifactPath).then((message: string) => {
        if (message) this.fail('Unable to open the downloaded update', 'install');
      });
      return;
    }
    this.installNow();
  };

  public installNow = () => {
    if (!isWindows || this.stage !== 'downloaded') return;
    this.captureRestoreRoute();
    this.app.isQuiting = true;
    const { app } = require('electron');
    app.releaseSingleInstanceLock();
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 100);
  };

  public installLater = () => {
    if (!isWindows || this.stage !== 'downloaded') return;
    autoUpdater.autoInstallOnAppQuit = true;
    this.mainWindow.broadcast('updateWillInstallLater');
  };

  public simulateUpdateAvailable = () => {
    if (!isDev) return;
    this.updateAvailable = true;
    this.setStage('available', {
      installMode: isWindows ? 'restart' : 'open-dmg',
      updateInfo: this.getCurrentUpdateInfo(),
    });
  };

  public simulateUpdateDownloaded = () => {
    if (!isDev) return;
    this.setStage('downloaded', {
      installMode: isWindows ? 'restart' : 'open-dmg',
      updateInfo: this.getCurrentUpdateInfo(),
    });
  };

  public simulateDownloadProgress = () => {
    if (!isDev) return;
    this.onDownloadProgress({ bytesPerSecond: 1024, percent: 50, total: 2048, transferred: 1024 });
  };

  private async fetchSignedManifest(): Promise<DesktopUpdateManifest> {
    const baseUrl = UPDATE_SERVER_URL!.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/${this.currentChannel}/${this.currentChannel}.json`);
    const response = await netFetch(url, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400)
      throw new SignedManifestError('Signed update manifest may not redirect', 'signature');
    if (!response.ok)
      throw new ArtifactDownloadError(
        `Update check failed with HTTP ${response.status}`,
        'network',
      );
    if (new URL(response.url).origin !== url.origin)
      throw new SignedManifestError('Signed update manifest left OSS', 'signature');
    return verifySignedManifest(await response.json(), {
      baseUrl,
      channel: this.currentChannel,
      currentVersion: electronApp.getVersion(),
    });
  }

  private configureWindowsProvider(version: string) {
    const baseUrl = UPDATE_SERVER_URL!.replace(/\/$/, '');
    autoUpdater.channel = this.currentChannel;
    autoUpdater.allowPrerelease = this.currentChannel !== 'stable';
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: `${baseUrl}/${this.currentChannel}/${version}`,
    });
  }

  private async verifyArtifactEndpoint(artifact: DesktopUpdateArtifact) {
    const baseUrl = UPDATE_SERVER_URL!.replace(/\/$/, '');
    const artifactUrl = new URL(`${baseUrl}/${artifact.path}`);
    const response = await netFetch(artifactUrl, { method: 'HEAD', redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      throw new SignedManifestError('Update artifacts may not redirect', 'signature');
    }
    if (!response.ok) {
      throw new ArtifactDownloadError(
        `Update artifact check failed with HTTP ${response.status}`,
        'network',
      );
    }
    if (new URL(response.url).origin !== artifactUrl.origin) {
      throw new SignedManifestError('Update artifact left OSS', 'signature');
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== artifact.size) {
      throw new ArtifactDownloadError('Update artifact size changed on OSS', 'integrity');
    }
  }

  private registerEvents() {
    autoUpdater.on('update-available', () => {
      if (this.isStaleCheck()) return;
      if (this.autoDownloadEnabled) void this.downloadUpdate();
    });
    autoUpdater.on('update-not-available', () =>
      this.fail('Signed update was not found in its immutable OSS directory', 'integrity'),
    );
    autoUpdater.on('error', (error: Error) => this.handleError(error));
    autoUpdater.on('download-progress', (progress: ProgressInfo) =>
      this.onDownloadProgress(progress),
    );
    autoUpdater.on('update-downloaded', () =>
      logger.info('NSIS updater download completed; verifying signed checksum'),
    );
  }

  private onDownloadProgress(progress: ProgressInfo) {
    this.latestProgress = progress;
    this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
    this.mainWindow.broadcast('updateDownloadProgress', progress);
  }

  private captureRestoreRoute() {
    try {
      const url = this.mainWindow.webContents?.getURL();
      const route = url ? extractRestoreRoute(url) : null;
      if (route) this.app.storeManager.set('pendingRestoreRoute', route);
    } catch (error) {
      logger.warn('Unable to capture the route before installing an update', error);
    }
  }

  private handleError(error: unknown) {
    if (error instanceof SignedManifestError || error instanceof ArtifactDownloadError) {
      this.fail(error.message, error.code);
      return;
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    const message = error instanceof Error ? error.message : 'Unknown updater error';
    if (code === 'ENOSPC') this.fail(message, 'disk');
    else if (
      ['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ETIMEDOUT'].includes(
        code ?? '',
      ) ||
      /(?:ERR_|HTTP|network|socket|timed?\s*out)/i.test(message)
    ) {
      this.fail(message, 'network');
    } else this.fail(message, 'unknown');
  }

  private fail(message: string, code: UpdaterErrorCode) {
    logger.error(`[Updater:${code}] ${message}`);
    this.setStage('error', { error: message, errorCode: code });
    this.mainWindow.broadcast('updateError', message);
  }

  private async cleanupUpdateCache() {
    const updateRoot = path.join(electronApp.getPath('userData'), 'updates');
    const staleBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      const channels = await readdir(updateRoot, { withFileTypes: true });
      for (const channel of channels) {
        if (!channel.isDirectory()) continue;
        const channelPath = path.join(updateRoot, channel.name);
        const entries = await readdir(channelPath, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(channelPath, entry.name);
          if (entry.isFile() && entry.name.endsWith('.part')) {
            await rm(entryPath, { force: true });
            continue;
          }
          if (!entry.isDirectory()) continue;
          const metadata = await stat(entryPath);
          if (metadata.mtimeMs < staleBefore) await rm(entryPath, { force: true, recursive: true });
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        logger.warn('Unable to clean the update cache', error);
    }
  }

  private resetPendingUpdate() {
    this.updateAvailable = false;
    this.pendingArtifact = null;
    this.pendingManifest = null;
    this.downloadedArtifactPath = null;
    this.installMode = null;
  }

  private isStaleCheck() {
    return this.activeGeneration !== this.checkGeneration;
  }

  private toUpdateInfo(manifest: DesktopUpdateManifest): UpdateInfo {
    return {
      releaseDate: manifest.releaseDate,
      releaseNotes: manifest.releaseNotes,
      version: manifest.version,
    };
  }

  private getCurrentUpdateInfo(): UpdateInfo {
    return { releaseDate: new Date().toISOString(), version: electronApp.getVersion() };
  }
}
