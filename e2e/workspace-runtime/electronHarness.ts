import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AcceptanceResultMap } from '../../test/workspace-runtime/contracts';

export type ElectronAcceptanceId =
  | 'AC-C04'
  | 'AC-C08'
  | 'AC-M03'
  | 'AC-P08'
  | 'AC-W04'
  | 'AC-W05'
  | 'AC-W06'
  | 'AC-W07'
  | 'AC-W08'
  | 'AC-W09'
  | 'AC-W10'
  | 'AC-X02';

export interface ElectronWorkspaceRuntimeSession {
  close: () => Promise<void>;
  observe: <Id extends ElectronAcceptanceId>(id: Id) => Promise<AcceptanceResultMap[Id]>;
}

/** Launches the real Electron process with isolated app state and observes through preload IPC. */
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
      observe: async <Id extends ElectronAcceptanceId>(id: Id) =>
        page.evaluate(
          (acceptanceId) =>
            (
              window as unknown as {
                masterinoElectronE2E: {
                  observeWorkspaceRuntime: (value: ElectronAcceptanceId) => Promise<unknown>;
                };
              }
            ).masterinoElectronE2E.observeWorkspaceRuntime(acceptanceId),
          id,
        ) as Promise<AcceptanceResultMap[Id]>,
    };
  };
