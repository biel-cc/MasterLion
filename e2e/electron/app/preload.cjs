/* eslint-disable @typescript-eslint/no-require-imports -- Electron preload runs as CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('masterinoElectronE2E', {
  runExecutionContext: () => ipcRenderer.invoke('masterino-e2e:run-execution-context'),
  runAihubReadiness: (scenario) =>
    ipcRenderer.invoke('masterino-e2e:run-aihub-readiness', scenario),
  runToolCall: (scenario) => ipcRenderer.invoke('masterino-e2e:run-tool-call', scenario),
});
