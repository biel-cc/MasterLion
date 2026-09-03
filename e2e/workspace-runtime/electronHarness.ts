import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

export interface ElectronWorkspaceRuntimeSession {
  close: () => Promise<void>;
  page: Page;
}

/** Launches the real Electron process with isolated app state and exposes its production renderer. */
export const launchElectronWorkspaceRuntimeSession =
  async (): Promise<ElectronWorkspaceRuntimeSession> => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'masterino-workspace-runtime-e2e-'));
    const { launchElectronTestApp } = await import('../electron/support/electronTestApp.mjs');
    const electronApp = await launchElectronTestApp({
      env: { MASTERINO_ELECTRON_E2E_STATE_ROOT: stateRoot },
    });
    const page = await electronApp.firstWindow();
    await page.waitForSelector('[data-testid="electron-runtime"]');

    return {
      close: async () => {
        await electronApp.close();
        await rm(stateRoot, { force: true, recursive: true });
      },
      page,
    };
  };
