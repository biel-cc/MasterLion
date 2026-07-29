import type * as LobechatConstModule from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ElectronState, initialState } from '@/store/electron/initialState';

import { electronSyncSelectors } from '../sync';

const mocks = vi.hoisted(() => ({
  isDesktop: true,
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();

  return {
    ...actual,
    get isDesktop() {
      return mocks.isDesktop;
    },
  };
});

vi.mock('@/utils/electron/desktopRuntimeConfig', () => ({
  getDesktopCloudServer: () => 'https://masterion.bielcrystal.com',
}));

const createState = (dataSyncConfig: ElectronState['dataSyncConfig']): ElectronState => ({
  ...initialState,
  dataSyncConfig,
});

describe('electronSyncSelectors', () => {
  beforeEach(() => {
    mocks.isDesktop = true;
  });

  describe('remoteServerUrl', () => {
    it('uses the sidecar URL mirrored into cloud config', () => {
      const state = createState({
        remoteServerUrl: 'https://masterion.bielcrystal.com',
        storageMode: 'cloud',
      });

      expect(electronSyncSelectors.remoteServerUrl(state)).toBe(
        'https://masterion.bielcrystal.com',
      );
    });

    it('falls back to the preload config before IPC hydration', () => {
      const state = createState({ storageMode: 'cloud' });

      expect(electronSyncSelectors.remoteServerUrl(state)).toBe(
        'https://masterion.bielcrystal.com',
      );
    });

    it('falls back to the official origin in web builds', () => {
      mocks.isDesktop = false;
      const state = createState({ storageMode: 'cloud' });

      expect(electronSyncSelectors.remoteServerUrl(state)).toBe('https://aihub.bielcrystal.com');
    });

    it('preserves the configured URL in self-hosted mode', () => {
      const state = createState({
        remoteServerUrl: 'https://self-hosted.example.com',
        storageMode: 'selfHost',
      });

      expect(electronSyncSelectors.remoteServerUrl(state)).toBe('https://self-hosted.example.com');
    });
  });
});
