import fs from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  type DeviceToolCallExecutionContext,
  ShellProcessManager,
} from '@lobechat/local-file-shell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeToolCall } from './index';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('executeToolCall', () => {
  const tmpDir = path.join(os.tmpdir(), 'cli-tool-dispatch-test-' + process.pid);
  let workspaceContext: DeviceToolCallExecutionContext;

  const executeWorkspaceTool = (apiName: string, args: Record<string, unknown>, timeout?: number) =>
    executeToolCall(apiName, JSON.stringify(args), timeout, workspaceContext);

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    const canonicalTmpDir = await realpath(tmpDir);
    workspaceContext = {
      accessRoots: [
        {
          modes: ['read', 'write', 'exec'],
          rootPath: canonicalTmpDir,
          scope: 'primary',
          source: 'workspace',
        },
      ],
      cwd: canonicalTmpDir,
      workspaceRootPath: canonicalTmpDir,
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  it('should dispatch readFile with formatted content and structured state', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writeFile(filePath, 'hello world');

    const result = await executeWorkspaceTool('readFile', { path: filePath });

    expect(result.success).toBe(true);
    // content is now the formatted prompt text, not raw JSON
    expect(result.content).toContain('hello world');
    // structured payload travels in `state` for client renders
    expect((result.state as { content: string }).content).toContain('hello world');
  });

  it('should dispatch writeFile', async () => {
    const filePath = path.join(tmpDir, 'new.txt');

    const result = await executeWorkspaceTool('writeFile', { content: 'written', path: filePath });

    expect(result.success).toBe(true);
    expect((result.state as { path: string }).path).toBe(await realpath(filePath));
    expect(fs.readFileSync(filePath, 'utf8')).toBe('written');
  });

  it('should dispatch legacy alias readLocalFile', async () => {
    const filePath = path.join(tmpDir, 'legacy.txt');
    await writeFile(filePath, 'legacy hello');

    const result = await executeWorkspaceTool('readLocalFile', { path: filePath });

    expect(result.success).toBe(true);
    expect((result.state as { content: string }).content).toContain('legacy hello');
  });

  it('should dispatch runCommand', async () => {
    const result = await executeWorkspaceTool('runCommand', { command: 'echo dispatched' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('dispatched');
    const state = result.state as { output?: string; stdout?: string };
    expect(state.stdout ?? state.output).toContain('dispatched');
  });

  it('uses execution-context cwd and emits a redacted override audit', async () => {
    const canonicalCwd = await realpath(tmpDir);
    const result = await executeToolCall(
      'runCommand',
      JSON.stringify({ command: 'pwd', cwd: '/tmp/evil', env: { MODEL_SECRET: 'drop' } }),
      undefined,
      {
        accessRoots: [
          {
            modes: ['read', 'write', 'exec'],
            rootPath: canonicalCwd,
            scope: 'primary',
            source: 'workspace',
          },
        ],
        cwd: canonicalCwd,
        env: { WORKSPACE_ENV: 'kept' },
        workspaceRootPath: canonicalCwd,
      },
      { deviceId: 'device-1', operationId: 'op-1', toolCallId: 'call-1', topicId: 'topic-1' },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain(canonicalCwd);
    expect(result.state).toMatchObject({
      scopeAudit: [expect.objectContaining({ cwdOverridden: true, scopeVerdict: 'primary' })],
    });
    expect(JSON.stringify(result.state)).not.toContain('/tmp/evil');
    expect(JSON.stringify(result)).not.toContain('MODEL_SECRET');
  });

  it('should dispatch listFiles', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'a');

    const result = await executeWorkspaceTool('listFiles', { path: tmpDir });

    expect(result.success).toBe(true);
    expect((result.state as { totalCount: number }).totalCount).toBeGreaterThan(0);
  });

  it('should dispatch globFiles', async () => {
    await writeFile(path.join(tmpDir, 'test.ts'), 'code');

    const result = await executeWorkspaceTool('globFiles', { cwd: tmpDir, pattern: '*.ts' });

    expect(result.success).toBe(true);
    expect((result.state as { files: string[] }).files).toContain('test.ts');
  });

  it('should dispatch editFile', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    await writeFile(filePath, 'old content');

    const result = await executeWorkspaceTool('editFile', {
      file_path: filePath,
      new_string: 'new content',
      old_string: 'old content',
    });

    expect(result.success).toBe(true);
    expect((result.state as { replacements: number }).replacements).toBeGreaterThan(0);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
  });

  it('should return error for unknown API', async () => {
    const result = await executeToolCall('unknownApi', '{}');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool API');
  });

  it('should carry structured state on file reads', async () => {
    const filePath = path.join(tmpDir, 'str.txt');
    await writeFile(filePath, 'content');

    const result = await executeWorkspaceTool('readFile', { path: filePath });

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
    expect(typeof result.content).toBe('string');
  });

  it('should return error for invalid JSON arguments', async () => {
    const result = await executeToolCall('readFile', 'not-json');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should dispatch grepContent', async () => {
    await writeFile(path.join(tmpDir, 'grep.txt'), 'findme here');

    const result = await executeWorkspaceTool('grepContent', { cwd: tmpDir, pattern: 'findme' });

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
  });

  it('should dispatch searchFiles', async () => {
    await writeFile(path.join(tmpDir, 'search_target.txt'), 'found');

    const result = await executeWorkspaceTool('searchFiles', {
      directory: tmpDir,
      keywords: 'search_target',
    });

    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();
  });

  it('should dispatch getCommandOutput', async () => {
    const result = await executeToolCall(
      'getCommandOutput',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    // The runtime envelopes a failed lookup as success:true with the failure in state
    expect(result.success).toBe(true);
    expect((result.state as { success: boolean }).success).toBe(false);
  });

  it('should forward the gateway timeout to getCommandOutput polling', async () => {
    const spy = vi
      .spyOn(ShellProcessManager.prototype, 'getOutput')
      .mockResolvedValue({ exit_code: 0, output: '', stderr: '', stdout: '', success: true });

    // 3rd arg is the gateway per-call timeout; executeToolCall injects it into args
    await executeToolCall('getCommandOutput', JSON.stringify({ shell_id: 'sid' }), 5000);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ shell_id: 'sid', timeout: 5000 }));
    spy.mockRestore();
  });

  it('should dispatch killCommand', async () => {
    const result = await executeToolCall(
      'killCommand',
      JSON.stringify({ shell_id: 'nonexistent' }),
    );

    expect(result.success).toBe(true);
    expect((result.state as { success: boolean }).success).toBe(false);
  });
});
