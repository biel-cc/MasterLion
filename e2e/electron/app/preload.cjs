/* eslint-disable @typescript-eslint/no-require-imports -- Electron preload runs as CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

const workspaceRuntimeRuns = new Map();

const unwrap = async (channel, ...args) => {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (response?.ok) return response;
  const error = new Error(response?.error?.message ?? `${channel} failed`);
  error.code = response?.error?.code;
  error.mainProcessStack = response?.error?.stack;
  throw error;
};

contextBridge.exposeInMainWorld('masterinoElectronE2E', {
  runAihubReadiness: (scenario) =>
    ipcRenderer.invoke('masterino-e2e:run-aihub-readiness', scenario),
  runToolCall: (scenario) => ipcRenderer.invoke('masterino-e2e:run-tool-call', scenario),
  /**
   * Workspace Runtime acceptance bridge. The seams themselves run in the
   * Electron main process against a real isolated database and filesystem;
   * only their observable results cross into the renderer.
   */
  workspaceRuntime: {
    counters: async () => (await unwrap('masterino-e2e:workspace-runtime-counters')).counters,
    dispose: () => unwrap('masterino-e2e:workspace-runtime-dispose'),
    // Memoized on purpose: the production UI and the spec read the same run, so
    // each acceptance row executes exactly once against the isolated database
    // and the provider/device counters stay meaningful.
    run: (acceptanceId) => {
      if (!workspaceRuntimeRuns.has(acceptanceId)) {
        workspaceRuntimeRuns.set(
          acceptanceId,
          unwrap('masterino-e2e:workspace-runtime-run', acceptanceId).then(({ result }) => result),
        );
      }
      return workspaceRuntimeRuns.get(acceptanceId);
    },
  },
});
