import { getDesktopCloudServer } from '@/utils/electron/desktopRuntimeConfig';

import { type ElectronState } from '../initialState';

const isSyncActive = (s: ElectronState) => s.dataSyncConfig.active;

const storageMode = (s: ElectronState) => s.dataSyncConfig.storageMode;

/**
 * Returns the effective remote server URL based on storage mode:
 * - Cloud mode: returns the value loaded from desktop-config.json
 * - SelfHost mode: returns the configured remoteServerUrl
 */
const remoteServerUrl = (s: ElectronState) =>
  s.dataSyncConfig.storageMode === 'cloud'
    ? s.dataSyncConfig.remoteServerUrl || getDesktopCloudServer()
    : s.dataSyncConfig.remoteServerUrl || '';

/**
 * Returns the raw remoteServerUrl from config without transformation.
 * Use this when you need the original configured value (e.g., for editing forms).
 */
const rawRemoteServerUrl = (s: ElectronState) => s.dataSyncConfig.remoteServerUrl || '';

export const electronSyncSelectors = {
  isSyncActive,
  rawRemoteServerUrl,
  remoteServerUrl,
  storageMode,
};
