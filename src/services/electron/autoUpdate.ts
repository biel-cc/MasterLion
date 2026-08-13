import type { UpdateChannel, UpdaterState } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class AutoUpdateService {
  checkUpdate = async () => {
    return ensureElectronIpc().autoUpdate.checkForUpdates();
  };

  installNow = async () => {
    return ensureElectronIpc().autoUpdate.quitAndInstallUpdate();
  };

  applyDownloadedUpdate = async () => {
    return ensureElectronIpc().autoUpdate.applyDownloadedUpdate();
  };

  installLater = async () => {
    return ensureElectronIpc().autoUpdate.installLater();
  };

  downloadUpdate() {
    return ensureElectronIpc().autoUpdate.downloadUpdate();
  }

  getUpdateChannel = async (): Promise<UpdateChannel> => {
    return ensureElectronIpc().autoUpdate.getUpdateChannel();
  };

  getAutoDownloadEnabled = async (): Promise<boolean> => {
    return ensureElectronIpc().autoUpdate.getAutoDownloadEnabled();
  };

  setAutoDownloadEnabled = async (enabled: boolean): Promise<void> => {
    return ensureElectronIpc().autoUpdate.setAutoDownloadEnabled(enabled);
  };

  getBuildChannel = async (): Promise<string> => {
    return ensureElectronIpc().autoUpdate.getBuildChannel();
  };

  setUpdateChannel = async (channel: UpdateChannel): Promise<void> => {
    return ensureElectronIpc().autoUpdate.setUpdateChannel(channel);
  };

  getUpdaterState = async (): Promise<UpdaterState> => {
    return ensureElectronIpc().autoUpdate.getUpdaterState();
  };
}

export const autoUpdateService = new AutoUpdateService();
