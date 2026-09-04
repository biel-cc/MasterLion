import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GatewayConnectionCtr from '../GatewayConnectionCtr';
import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';
import LocalFileCtr from '../LocalFileCtr';
import RemoteServerConfigCtr from '../RemoteServerConfigCtr';
import ShellCommandCtr from '../ShellCommandCtr';

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/mock/app'), getPath: vi.fn(() => '/mock') },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
}));

vi.mock('electron-is', () => ({ linux: false, macOS: false, windows: false }));

vi.mock('@/const/env', () => ({
  OFFICIAL_CLOUD_SERVER: 'https://example.test',
  isDev: false,
  isLinux: false,
  isMac: false,
  isWindows: false,
}));

vi.mock('@/services/imessageBridgeSrv', () => ({ default: class ImessageBridgeService {} }));
vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('fast-glob', () => ({ default: vi.fn() }));
vi.mock('fflate', () => ({ unzipSync: vi.fn() }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('GatewayConnectionCtr execution context boundary', () => {
  let tempRoot: string;
  let workspace: string;
  const handleRunCommand = vi.fn(async () => ({ success: true, stdout: 'ok' }));
  const readFile = vi.fn(async () => ({ content: 'safe' }));
  const spawnLhHeteroExec = vi.fn();

  const localFileCtr = {
    handleEditFile: vi.fn(),
    handleGlobFiles: vi.fn(),
    handleGrepContent: vi.fn(),
    handleLocalFilesSearch: vi.fn(),
    handleMoveFiles: vi.fn(),
    handleRenameFile: vi.fn(),
    handleWriteFile: vi.fn(),
    listLocalFiles: vi.fn(),
    readFile,
    readFiles: vi.fn(),
  } as unknown as LocalFileCtr;

  const shellCommandCtr = {
    handleGetCommandOutput: vi.fn(),
    handleKillCommand: vi.fn(),
    handleRunCommand,
  } as unknown as ShellCommandCtr;

  const makeController = (allowedMountRoots: string[] = []) =>
    new GatewayConnectionCtr({
      appStoragePath: path.join(tempRoot, 'app-storage'),
      getController: (Controller: unknown) => {
        if (Controller === LocalFileCtr) return localFileCtr;
        if (Controller === ShellCommandCtr) return shellCommandCtr;
        if (Controller === RemoteServerConfigCtr) {
          return {
            getAccessToken: vi.fn(async () => 'token'),
            getRemoteServerUrl: vi.fn(async () => 'https://example.test'),
          };
        }
        if (Controller === HeterogeneousAgentCtr) return { spawnLhHeteroExec };
        return {};
      },
      storeManager: {
        get: (key: string, fallback: unknown) =>
          key === 'localFileWorkspaceRoots' ? allowedMountRoots : fallback,
      },
    } as any);

  const context = () => ({
    accessRoots: [
      {
        modes: ['read' as const, 'write' as const, 'exec' as const],
        rootPath: workspace,
        scope: 'primary' as const,
        source: 'workspace' as const,
      },
    ],
    cwd: workspace,
    env: { SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
    envFiles: ['.env'],
    workspaceRootPath: workspace,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(path.join(tmpdir(), 'desktop-execution-context-'));
    workspace = path.join(tempRoot, 'workspace');
    await mkdir(workspace);
    workspace = await realpath(workspace);
    await writeFile(path.join(workspace, '.env'), 'FILE_ONLY=from-file\nSHARED=from-file\n');
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it('rejects a standalone renderer tool_execute even with a forged frozen context', async () => {
    const file = path.join(workspace, 'safe.txt');
    await writeFile(file, 'safe');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: 'safe.txt' },
      executionContext: context(),
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ content: 'SERVER_AUTHORITY_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('blocks an absolute standalone renderer read outside the frozen workspace', async () => {
    const outside = path.join(tempRoot, 'outside.txt');
    await writeFile(outside, 'secret');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: outside },
      executionContext: context(),
      trace: {
        deviceId: 'device-1',
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ content: 'SERVER_AUTHORITY_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails closed when standalone tool_execute loses its execution context', async () => {
    const file = path.join(workspace, 'safe.txt');
    await writeFile(file, 'safe');
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'readFile',
      args: { path: file },
      trace: {
        operationId: 'op-1',
        toolCallId: 'call-1',
        topicId: 'topic-1',
      },
    });

    expect(result).toMatchObject({ content: 'SERVER_AUTHORITY_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects a context-free renderer runCommand without trace metadata', async () => {
    const controller = makeController();

    const result = await controller.executeLocalToolCall({
      apiName: 'runCommand',
      args: { command: 'id' },
    });

    expect(result).toMatchObject({ content: 'SERVER_AUTHORITY_REQUIRED', success: false });
    expect(handleRunCommand).not.toHaveBeenCalled();
  });

  it('overrides model runCommand.cwd and returns redacted scope evidence', async () => {
    const controller = makeController();
    const result = await (controller as any).executeToolCall(
      'runCommand',
      { command: 'pwd', cwd: '/tmp/evil', env: { MODEL_SECRET: 'drop' } },
      context(),
      { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 'topic-1' },
    );

    expect(handleRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspace,
        env: { FILE_ONLY: 'from-file', SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
      }),
    );
    expect(result.state.scopeAudit).toEqual([
      expect.objectContaining({ cwdOverridden: true, scopeVerdict: 'primary' }),
    ]);
    expect(JSON.stringify(result.state.workspaceWarnings)).not.toContain('/tmp/evil');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
  });

  it('spawns a gateway agent run with only the server-frozen cwd and environment', async () => {
    const controller = makeController();

    const result = await (controller as any).executeAgentRun({
      agentType: 'codex',
      cwd: '/tmp/legacy',
      env: { LEGACY_SECRET: 'drop' },
      executionContext: context(),
      jwt: 'operation-jwt',
      operationId: 'op-1',
      prompt: 'run in the project',
      topicId: 'topic-1',
      type: 'agent_run_request',
    });

    expect(result).toEqual({ status: 'accepted' });
    expect(spawnLhHeteroExec).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspace,
        env: { FILE_ONLY: 'from-file', SHARED: 'server-wins', WORKSPACE_ENV: 'kept' },
        operationId: 'op-1',
        topicId: 'topic-1',
      }),
    );
    expect(JSON.stringify(spawnLhHeteroExec.mock.calls[0])).not.toContain('LEGACY_SECRET');
  });

  it('returns WORKSPACE_REQUIRED before spawning when v2 context has no cwd', async () => {
    const controller = makeController();
    const result = await (controller as any).executeToolCall(
      'runCommand',
      { command: 'pwd' },
      { accessRoots: [] },
    );

    expect(result).toMatchObject({ content: 'WORKSPACE_REQUIRED', success: false });
    expect(handleRunCommand).not.toHaveBeenCalled();
  });

  it('requires intervention before a symlink may read outside the primary root', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspace, 'link'));
    const controller = makeController();

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: 'link/secret.txt' },
      context(),
    );

    expect(result).toMatchObject({ content: 'INTERVENTION_REQUIRED', success: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('returns runtime-authored structured consent metadata for an out-of-scope read', async () => {
    const outside = path.join(tempRoot, 'shared');
    await mkdir(outside);
    const file = path.join(outside, 'note.txt');
    await writeFile(file, 'shared');
    const canonicalFile = await realpath(file);
    const controller = makeController();

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: file },
      context(),
      { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 'topic-1' },
    );

    expect(result).toMatchObject({
      content: 'INTERVENTION_REQUIRED',
      state: {
        workspacePathConsent: {
          actualCwd: workspace,
          deviceId: 'device-1',
          modes: ['read'],
          operationId: 'op-1',
          primaryCwd: workspace,
          requestedPath: canonicalFile,
          topicId: 'topic-1',
          version: 1,
        },
      },
      success: false,
    });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('uses the device-local approved mount list for a gateway direct-message read', async () => {
    const mountRoot = path.join(tempRoot, 'Volumes');
    const project = path.join(mountRoot, 'ExternalDisk', 'project');
    const file = path.join(project, 'note.txt');
    await mkdir(project, { recursive: true });
    await writeFile(file, 'mounted');
    const canonicalFile = await realpath(file);
    const controller = makeController([mountRoot]);

    const result = await (controller as any).executeToolCall(
      'readFile',
      { path: file },
      {
        accessRoots: [
          {
            modes: ['read'],
            operationId: 'op-mounted',
            rootPath: project,
            scope: 'operation',
            source: 'direct-user-message',
          },
        ],
      },
      {
        deviceId: 'device-1',
        operationId: 'op-mounted',
        toolCallId: 'call-mounted',
        topicId: 'topic-1',
      },
    );

    expect(result).toMatchObject({ success: true });
    expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ path: canonicalFile }));
    expect(result.state.scopeAudit).toEqual([
      expect.objectContaining({ scopeVerdict: 'consent:op-mounted' }),
    ]);
  });
});
