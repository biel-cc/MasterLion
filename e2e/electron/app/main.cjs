/* eslint-disable @typescript-eslint/no-require-imports -- Electron launches this test harness as CommonJS. */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (process.env.MASTERINO_ELECTRON_E2E !== '1') {
  throw new Error('The Electron lifecycle harness is test-only');
}

const lifecycleModuleUrl = pathToFileURL(
  path.join(__dirname, '../.artifacts/ToolCallLifecycle.mjs'),
).href;
const retryPolicyModuleUrl = pathToFileURL(
  path.join(__dirname, '../.artifacts/retryPolicy.mjs'),
).href;

const toSnapshot = (state) => ({
  localExecutionCount: state.localExecutionCount,
  prepareAttempts: state.prepareAttempts,
  resultSyncAttempts: state.resultSyncAttempts,
  runningOperationCount: [...state.operations.values()].filter(({ status }) => status === 'running')
    .length,
});

const runTransientScenario = async ({
  cancelExecution = false,
  exhaustCommit = false,
  exhaustPrepare = false,
} = {}) => {
  const [{ ToolCallLifecycle }, { createDefaultToolCallRetryPolicy }] = await Promise.all([
    import(lifecycleModuleUrl),
    import(retryPolicyModuleUrl),
  ]);
  const state = {
    localExecutionCount: 0,
    operationSequence: 0,
    operations: new Map(),
    prepareAttempts: 0,
    resultSyncAttempts: 0,
  };

  const operations = {
    cancel: (operationId) => {
      state.operations.get(operationId).status = 'cancelled';
    },
    complete: (operationId) => {
      state.operations.get(operationId).status = 'completed';
    },
    fail: (operationId, error) => {
      const operation = state.operations.get(operationId);
      operation.error = error;
      operation.status = 'failed';
    },
    get: (operationId) => state.operations.get(operationId),
    start: ({ parentOperationId, type }) => {
      const operation = {
        id: `operation-${++state.operationSequence}`,
        parentOperationId,
        signal: new AbortController().signal,
        status: 'running',
        type,
      };
      state.operations.set(operation.id, operation);
      return operation;
    },
    updateMetadata: (operationId, metadata) => {
      const operation = state.operations.get(operationId);
      operation.metadata = { ...operation.metadata, ...metadata };
    },
  };

  const defaultRetry = createDefaultToolCallRetryPolicy();
  const batchController = new AbortController();
  let cancellationTimer;
  const lifecycle = new ToolCallLifecycle({
    executor: {
      execute: async () => {
        state.localExecutionCount += 1;
        if (cancelExecution) {
          cancellationTimer = setTimeout(
            () => batchController.abort('cancelled from Electron renderer'),
            100,
          );
          return new Promise(() => {});
        }
        return { content: 'local tool completed', success: true };
      },
    },
    ids: { createExecutionAttemptId: () => 'execution-attempt-1' },
    messages: {
      commitResult: async () => {
        state.resultSyncAttempts += 1;
        if (exhaustCommit) {
          throw Object.assign(new Error('result gateway unavailable'), {
            data: { httpStatus: 502 },
          });
        }
      },
      ensurePrepared: async ({ messageId }) => {
        state.prepareAttempts += 1;
        if (exhaustPrepare || state.prepareAttempts < 3) {
          throw Object.assign(new Error('temporary gateway failure'), {
            data: { httpStatus: 502 },
          });
        }
        return { disposition: 'created', messageId };
      },
    },
    operations,
    retry: {
      ...defaultRetry,
      delaysMs: [0, 250, 350],
      jitterRatio: 0,
      random: () => 0.5,
      totalTimeoutMs: 5_000,
    },
  });

  try {
    await lifecycle.run({
      context: { agentId: 'electron-e2e-agent', topicId: 'electron-e2e-topic' },
      message: {
        kind: 'create',
        messageId: 'electron-e2e-tool-message',
        parentMessageId: 'electron-e2e-assistant-message',
      },
      parentOperationId: 'electron-e2e-root-operation',
      signal: batchController.signal,
      toolCall: {
        apiName: 'runCommand',
        arguments: '{"command":"echo electron-e2e"}',
        id: 'electron-e2e-tool-call',
        identifier: 'lobe-local-system',
        type: 'builtin',
      },
    });

    return { ok: true, snapshot: toSnapshot(state) };
  } catch (error) {
    return {
      error: {
        code: error?.code ?? 'UNEXPECTED_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      ok: false,
      snapshot: toSnapshot(state),
    };
  } finally {
    if (cancellationTimer) clearTimeout(cancellationTimer);
  }
};

ipcMain.handle('masterino-e2e:run-tool-call', async (_event, scenario) => {
  if (scenario === 'transient') return runTransientScenario();
  if (scenario === 'exhausted') return runTransientScenario({ exhaustPrepare: true });
  if (scenario === 'sync-exhausted') return runTransientScenario({ exhaustCommit: true });
  if (scenario === 'cancelled') return runTransientScenario({ cancelExecution: true });

  return {
    error: { code: 'NOT_IMPLEMENTED', message: `Scenario ${scenario} is not implemented` },
    ok: false,
    snapshot: {
      localExecutionCount: 0,
      prepareAttempts: 0,
      resultSyncAttempts: 0,
      runningOperationCount: 0,
    },
  };
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 640,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    width: 900,
  });

  await window.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
