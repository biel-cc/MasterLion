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
const aihubReadinessModuleUrl = pathToFileURL(
  path.join(__dirname, '../.artifacts/AihubReadiness.mjs'),
).href;

const createAihubHarness = async ({ legacyTransient = false } = {}) => {
  const { AihubReadiness, AihubReadinessError } = await import(aihubReadinessModuleUrl);
  let binding = legacyTransient
    ? {
        managedTokenId: 8001,
        newApiUserId: 9001,
        readinessVersion: 1,
        status: 'active',
      }
    : undefined;
  let leaseOwner;
  let localRuntimeReady = legacyTransient;
  let provisionCount = 0;
  let reconcileErrorCount = 0;
  const bindingStore = {
    get: async () => binding,
    markActive: async (_userId, input) => {
      binding = { ...binding, ...input, status: 'active' };
      localRuntimeReady = true;
    },
    markError: async (_userId, input) => {
      binding = { ...binding, ...input, status: 'error' };
    },
    markPending: async () => {
      binding = {
        ...binding,
        attemptCount: (binding?.attemptCount ?? 0) + 1,
        status: 'pending',
      };
    },
    markReconcileError: async (_userId, input) => {
      reconcileErrorCount += 1;
      binding = { ...binding, ...input, status: 'active' };
    },
    updateIamBinding: async (_userId, input) => {
      binding = {
        ...binding,
        iamOAuthBindingStatus: input.status,
      };
    },
  };
  const lease = {
    acquire: async (_userId, ownerId) => {
      if (leaseOwner) return undefined;
      leaseOwner = ownerId;
      return { expiresAt: new Date(Date.now() + 60_000), ownerId };
    },
    release: async (_userId, ownerId) => {
      if (leaseOwner === ownerId) leaseOwner = undefined;
    },
  };
  const workflow = {
    inspectLocalRuntime: async () => ({
      hasApiKey: localRuntimeReady,
      modelCount: localRuntimeReady ? 3 : 0,
    }),
    provision: async () => {
      provisionCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 75));
      if (legacyTransient) {
        throw new AihubReadinessError(
          'Aihub bridge is temporarily unavailable',
          'transient',
          'aihub_bridge_unavailable',
        );
      }
      return {
        iamOAuthBinding: { status: 'active' },
        managedTokenId: 8001,
        modelCount: 3,
        newApiUserId: 9001,
      };
    },
  };
  const options = {
    bindingStore,
    identitySource: {
      getEnterpriseIdentity: async () => ({
        employeeNumber: '10184591',
        employmentStatus: 'active',
        masterinoUsername: '10184591',
      }),
    },
    lease,
    workflow,
  };

  return {
    createRuntime: () => new AihubReadiness(options),
    getProvisionCount: () => provisionCount,
    getReconcileErrorCount: () => reconcileErrorCount,
  };
};

ipcMain.handle('masterino-e2e:run-aihub-readiness', async (_event, scenario) => {
  const harness = await createAihubHarness({ legacyTransient: scenario === 'legacy-transient' });
  if (scenario === 'concurrent') {
    const runtime = harness.createRuntime();
    const states = await Promise.all(
      Array.from({ length: 20 }, () => runtime.ensure('user-1', { trigger: 'oidc_authorized' })),
    );
    return {
      activeCount: states.filter(({ status }) => status === 'active').length,
      pendingCount: states.filter(({ status }) => status === 'pending').length,
      provisionCount: harness.getProvisionCount(),
      status: 'completed',
    };
  }
  if (scenario === 'relaunch') {
    await harness.createRuntime().ensure('user-1', { trigger: 'oidc_authorized' });
    const relaunchedState = await harness
      .createRuntime()
      .ensure('user-1', { trigger: 'model_runtime' });
    return {
      activeCount: relaunchedState.status === 'active' ? 1 : 0,
      pendingCount: 0,
      provisionCount: harness.getProvisionCount(),
      status: relaunchedState.status,
    };
  }
  if (scenario === 'legacy-transient') {
    const state = await harness
      .createRuntime()
      .ensure('user-1', { trigger: 'model_runtime' });
    return {
      activeCount: state.status === 'active' ? 1 : 0,
      pendingCount: 0,
      provisionCount: harness.getProvisionCount(),
      reconcileErrorCount: harness.getReconcileErrorCount(),
      status: state.status,
    };
  }

  return {
    activeCount: 0,
    pendingCount: 0,
    provisionCount: 0,
    reconcileErrorCount: 0,
    status: 'failed',
  };
});

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
