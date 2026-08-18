import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  ProgressInfo,
  UpdateChannel,
  UpdateInfo,
  UpdaterDiagnostic,
  UpdaterDiagnosticStepName,
  UpdaterDiagnosticStepStatus,
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
  ArtifactDownloadError,
  downloadArtifact,
  verifyArtifact,
} from '@/modules/updater/artifactDownloader';
import {
  BUILD_CHANNEL,
  resolveInitialUpdateChannel,
  UPDATE_CHANNEL,
  UPDATE_SERVER_URL,
  updaterConfig,
} from '@/modules/updater/configs';
import {
  type DesktopUpdateArtifact,
  type DesktopUpdateManifest,
  resolveArtifactUrl,
  selectUpdateArtifact,
  SignedManifestError,
  verifySignedManifest,
} from '@/modules/updater/signedManifest';
import { extractRestoreRoute } from '@/modules/updater/utils';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';

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
  private latestDiagnostic: UpdaterDiagnostic | null = null;
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
      manualDownloadAvailable: Boolean(this.pendingArtifact && this.pendingManifest),
      runtime: {
        arch: process.arch,
        buildChannel: BUILD_CHANNEL,
        currentVersion: electronApp.getVersion(),
        platform: process.platform,
        updateChannel: this.currentChannel,
      },
      stage: this.stage,
    };
    if (this.latestDiagnostic) {
      state.diagnostic = {
        ...this.latestDiagnostic,
        artifact: this.latestDiagnostic.artifact
          ? { ...this.latestDiagnostic.artifact }
          : undefined,
        steps: this.latestDiagnostic.steps.map((step) => ({ ...step })),
      };
    }
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
    if (this.latestDiagnostic) {
      this.latestDiagnostic.stage = stage;
      if (opts?.updateInfo?.version) this.latestDiagnostic.targetVersion = opts.updateInfo.version;
      if (opts?.error !== undefined)
        this.latestDiagnostic.errorMessage = this.sanitizeDiagnosticText(opts.error);
      if (opts?.errorCode !== undefined) this.latestDiagnostic.errorCode = opts.errorCode;
      if (stage === 'latest' || stage === 'downloaded' || stage === 'error') {
        this.latestDiagnostic.finishedAt = new Date().toISOString();
      }
      this.persistDiagnostic();
    }
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
    const storedDiagnostic = this.app.storeManager.get('lastUpdaterDiagnostic');
    if (storedDiagnostic?.schemaVersion === 1 && Array.isArray(storedDiagnostic.steps)) {
      this.latestDiagnostic = storedDiagnostic;
    }
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
    this.startDiagnostic(manual ? 'manual' : 'automatic');
    if (!UPDATE_SERVER_URL) {
      this.fail('Update server is not configured', 'network');
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
      this.latestDiagnostic!.targetVersion = manifest.version;
      this.recordDiagnosticStep(
        'version-compared',
        'success',
        `Installed ${currentVersion}; manifest ${manifest.version}`,
      );
      if (!semver.gt(manifest.version, currentVersion)) {
        this.resetPendingUpdate();
        this.recordDiagnosticStep('check-completed', 'success', 'The installed version is current');
        this.setStage('latest', { updateInfo: this.toUpdateInfo(manifest) });
        return;
      }
      const artifact = selectUpdateArtifact(manifest, process.platform, process.arch);
      if (!artifact)
        throw new SignedManifestError('No signed artifact for this platform', 'signature');
      this.pendingManifest = manifest;
      this.pendingArtifact = artifact;
      this.latestDiagnostic!.artifact = {
        arch: artifact.arch,
        path: artifact.path,
        platform: artifact.platform,
        size: artifact.size,
      };
      this.recordDiagnosticStep(
        'artifact-selected',
        'success',
        `${artifact.platform}/${artifact.arch} ${artifact.path} (${artifact.size} bytes)`,
      );
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
      if (this.stage === 'available') {
        this.recordDiagnosticStep('check-completed', 'success', 'An update is available');
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
    this.recordDiagnosticStep(
      'download-started',
      'info',
      `${this.pendingArtifact.platform}/${this.pendingArtifact.arch} ${this.pendingArtifact.size} bytes`,
    );
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
        this.recordDiagnosticStep('artifact-verified', 'success', 'SHA-512 and size verified');
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
        this.recordDiagnosticStep('artifact-verified', 'success', 'SHA-512 and size verified');
      }
      this.recordDiagnosticStep('download-completed', 'success', 'The update is ready to install');
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
      this.recordDiagnosticStep('update-opened', 'info', 'Opening the verified DMG');
      void shell.openPath(this.downloadedArtifactPath).then((message: string) => {
        if (message) this.fail(message, 'install');
        else this.recordDiagnosticStep('update-opened', 'success', 'Opened the verified DMG');
      });
      return;
    }
    this.installNow();
  };

  public installNow = () => {
    if (!isWindows || this.stage !== 'downloaded') return;
    this.recordDiagnosticStep(
      'update-opened',
      'success',
      'Starting the verified Windows installer',
    );
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

  public openManualDownload = async (): Promise<'opened' | 'unavailable'> => {
    if (!this.pendingArtifact || !this.pendingManifest || !UPDATE_SERVER_URL) return 'unavailable';
    const url = resolveArtifactUrl(UPDATE_SERVER_URL, this.pendingArtifact.path);
    await shell.openExternal(url.toString());
    this.recordDiagnosticStep(
      'update-opened',
      'info',
      'Opened the verified OSS artifact in a browser',
    );
    return 'opened';
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
    this.recordDiagnosticStep('manifest-requested', 'info', url.toString());
    const response = await netFetch(url.toString(), { redirect: 'manual' });
    if (this.latestDiagnostic) {
      this.latestDiagnostic.manifestHttpStatus = response.status;
      this.persistDiagnostic();
    }
    this.recordDiagnosticStep(
      'manifest-received',
      response.ok ? 'success' : 'error',
      `HTTP ${response.status}`,
    );
    // Electron documents Response.url as unreliable. Manual redirects are never
    // followed: Electron rejects them, while fetch-compatible mocks may expose 3xx.
    if (response.status >= 300 && response.status < 400)
      throw new SignedManifestError('Signed update manifest may not redirect', 'signature');
    if (!response.ok)
      throw new ArtifactDownloadError(
        `Update check failed with HTTP ${response.status}`,
        'network',
      );
    this.recordDiagnosticStep('manifest-verified', 'info', 'Verifying the Ed25519 signature');
    const manifest = verifySignedManifest(await response.json(), {
      baseUrl,
      channel: this.currentChannel,
      currentVersion: electronApp.getVersion(),
    });
    this.recordDiagnosticStep(
      'manifest-verified',
      'success',
      `Ed25519 signature verified for ${manifest.version}`,
    );
    return manifest;
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
    const response = await netFetch(artifactUrl.toString(), {
      method: 'HEAD',
      redirect: 'manual',
    });
    // Do not read Electron's unreliable Response.url; manual redirects are not followed.
    if (response.status >= 300 && response.status < 400) {
      throw new SignedManifestError('Update artifacts may not redirect', 'signature');
    }
    if (!response.ok) {
      throw new ArtifactDownloadError(
        `Update artifact check failed with HTTP ${response.status}`,
        'network',
      );
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) !== artifact.size) {
      throw new ArtifactDownloadError('Update artifact size changed on OSS', 'integrity');
    }
    this.recordDiagnosticStep(
      'artifact-verified',
      'success',
      `OSS endpoint verified (${contentLength ?? 'unknown'} bytes)`,
    );
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
      /ERR_|HTTP|network|socket|timed?\s*out/i.test(message)
    ) {
      this.fail(message, 'network');
    } else this.fail(message, 'unknown');
  }

  private fail(message: string, code: UpdaterErrorCode) {
    const safeMessage = this.sanitizeDiagnosticText(message);
    if (this.latestDiagnostic) {
      this.latestDiagnostic.failedStep = this.latestDiagnostic.steps.at(-1)?.name;
    }
    this.recordDiagnosticStep('failed', 'error', `${code}: ${safeMessage}`);
    logger.error(`[Updater:${code}] ${safeMessage}`);
    this.setStage('error', { error: safeMessage, errorCode: code });
    this.mainWindow.broadcast('updateError', safeMessage);
  }

  private startDiagnostic(trigger: 'automatic' | 'manual') {
    const now = new Date().toISOString();
    const baseUrl = UPDATE_SERVER_URL?.replace(/\/$/, '') ?? '';
    this.latestDiagnostic = {
      arch: process.arch,
      channel: this.currentChannel,
      currentVersion: electronApp.getVersion(),
      id: randomUUID(),
      manifestUrl: this.sanitizeDiagnosticText(
        `${baseUrl}/${this.currentChannel}/${this.currentChannel}.json`,
      ),
      platform: process.platform,
      schemaVersion: 1,
      stage: 'checking',
      startedAt: now,
      steps: [],
      trigger,
    };
    this.recordDiagnosticStep('check-started', 'info', `${trigger} update check`);
  }

  private recordDiagnosticStep(
    name: UpdaterDiagnosticStepName,
    status: UpdaterDiagnosticStepStatus,
    detail?: string,
  ) {
    if (!this.latestDiagnostic) return;
    const safeDetail = detail ? this.sanitizeDiagnosticText(detail) : undefined;
    this.latestDiagnostic.steps.push({
      at: new Date().toISOString(),
      detail: safeDetail,
      name,
      status,
    });
    this.persistDiagnostic();
    logger.info(
      `[UpdaterDiagnostic:${this.latestDiagnostic.id}] ${status} ${name}${safeDetail ? `: ${safeDetail}` : ''}`,
    );
  }

  private persistDiagnostic() {
    if (!this.latestDiagnostic) return;
    this.app.storeManager.set('lastUpdaterDiagnostic', this.latestDiagnostic);
  }

  private sanitizeDiagnosticText(value: string) {
    return value
      .replaceAll(
        /([?&](?:access_token|api_key|key|password|proxy_password|signature|token)=)[^&\s]+/gi,
        '$1[redacted]',
      )
      .replaceAll(/((?:proxy-)?authorization\s*:\s*)(?:basic|bearer)\s+\S+/gi, '$1[redacted]')
      .replaceAll(/https?:\/\/[^/\s@]+@/gi, 'https://[redacted]@')
      .replaceAll(/\/(?:Users|home|private\/var\/folders|tmp|var\/folders)\/\S+/g, '[local-path]')
      .replaceAll(/[A-Z]:\\\S+/gi, '[local-path]')
      .slice(0, 1000);
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
