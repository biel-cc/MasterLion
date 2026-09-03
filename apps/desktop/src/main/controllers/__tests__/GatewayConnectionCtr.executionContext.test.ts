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

  const makeController = () =>
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
        if (Controller === HeterogeneousAgentCtr) return { spawnLhHeteroExec: vi.fn() };
        return {};
      },
    } as any);

  const context = () => ({
    accessRoots: [
      {
        modes: ['read', 'write', 'exec'] as const,
        rootPath: workspace,
        scope: 'primary' as const,
        source: 'workspace' as const,
      },
    ],
    cwd: workspace,
    env: { WORKSPACE_ENV: 'kept' },
    workspaceRootPath: workspace,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(path.join(tmpdir(), 'desktop-execution-context-'));
    workspace = path.join(tempRoot, 'workspace');
    await mkdir(workspace);
    workspace = await realpath(workspace);
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
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
      expect.objectContaining({ cwd: workspace, env: { WORKSPACE_ENV: 'kept' } }),
    );
    expect(result.state.scopeAudit).toEqual([
      expect.objectContaining({ cwdOverridden: true, scopeVerdict: 'primary' }),
    ]);
    expect(JSON.stringify(result.state.workspaceWarnings)).not.toContain('/tmp/evil');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
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
});
