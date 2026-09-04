import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Page } from '@playwright/test';

import type {
  ElectronAcceptanceId,
  ElectronAcceptanceResultMap,
  WorkspaceRuntimeCounters,
} from '../electron/production-app/workspaceRuntimeSeams';

export type {
  ElectronAcceptanceId,
  ElectronAcceptanceResultMap,
  WorkspaceRuntimeCounters,
} from '../electron/production-app/workspaceRuntimeSeams';

export interface ElectronWorkspaceRuntimeSession {
  close: () => Promise<void>;
  /** Provider/device port call counts recorded inside the Electron main process. */
  counters: () => Promise<WorkspaceRuntimeCounters>;
  page: Page;
  /**
   * Executes an acceptance row through the preload IPC bridge. The row itself
   * runs in the Electron **main** process against the repository's isolated
   * PGlite database and a unique temporary filesystem rooted under
   * `stateRoot`. Runs are memoized in the preload, so the production renderer
   * and this method observe the same single execution of each row.
   */
  run: <Id extends ElectronAcceptanceId>(
    acceptanceId: Id,
  ) => Promise<ElectronAcceptanceResultMap[Id]>;
  stateRoot: string;
}

interface WorkspaceRuntimeBridgeWindow {
  masterinoElectronE2E?: {
    workspaceRuntime?: {
      counters: () => Promise<WorkspaceRuntimeCounters>;
      dispose: () => Promise<unknown>;
      run: (acceptanceId: string) => Promise<unknown>;
    };
  };
}

const MISSING_BRIDGE = 'The Workspace Runtime preload bridge is not exposed';

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
    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as WorkspaceRuntimeBridgeWindow).masterinoElectronE2E
            ?.workspaceRuntime,
        ),
      undefined,
      { timeout: 30_000 },
    );

    // Ask the main process to close the isolated database and delete the
    // temporary tree it created, then drop the state root itself. A window
    // that already died must not prevent the filesystem cleanup below, and a
    // main process that never finished initializing reports nothing to close —
    // teardown must not restate the failure that already failed the test.
    let closePromise: Promise<void> | undefined;
    const close = async () => {
      let disposeError: unknown;
      if (!page.isClosed()) {
        try {
          await page.evaluate(async (missing) => {
            const bridge = (window as unknown as WorkspaceRuntimeBridgeWindow).masterinoElectronE2E
              ?.workspaceRuntime;
            if (!bridge) throw new Error(missing);
            await bridge.dispose();
          }, MISSING_BRIDGE);
        } catch (error) {
          disposeError = error;
        }
      }
      await electronApp.close();
      await rm(stateRoot, { force: true, recursive: true });
      if (disposeError) throw disposeError;
    };

    return {
      // Idempotent: closing twice performs the teardown once and replays its
      // outcome, so a spec that closes early does not tear down a second time.
      close: () => (closePromise ??= close()),
      counters: () =>
        page.evaluate(async (missing) => {
          const bridge = (window as unknown as WorkspaceRuntimeBridgeWindow).masterinoElectronE2E
            ?.workspaceRuntime;
          if (!bridge) throw new Error(missing);
          return bridge.counters();
        }, MISSING_BRIDGE),
      page,
      run: (acceptanceId) =>
        page.evaluate(
          async ([id, missing]) => {
            const bridge = (window as unknown as WorkspaceRuntimeBridgeWindow).masterinoElectronE2E
              ?.workspaceRuntime;
            if (!bridge) throw new Error(missing);
            return bridge.run(id);
          },
          [acceptanceId, MISSING_BRIDGE] as const,
        ) as never,
      stateRoot,
    };
  };
