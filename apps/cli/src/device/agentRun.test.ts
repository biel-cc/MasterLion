import type * as childProcessModule from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type * as localFileShellModule from '@lobechat/local-file-shell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawnHeteroAgentRun } from './agentRun';

const { materializeSkillsForCliMock, spawnMock } = vi.hoisted(() => ({
  materializeSkillsForCliMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  spawn: spawnMock,
}));
vi.mock('@lobechat/device-control', () => ({
  materializeSkillsForCli: materializeSkillsForCliMock,
}));
vi.mock('@lobechat/local-file-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof localFileShellModule>()),
  resolveLoginShellPath: vi.fn().mockResolvedValue('/login/bin'),
}));

const makeFakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  };
  child.stdin = { end: vi.fn(), write: vi.fn() };
  return child;
};

const baseParams = {
  agentType: 'claudeCode',
  cwd: '/work/dir',
  jwt: 'jwt',
  operationId: 'op',
  prompt: 'hi',
  serverUrl: 'https://aihub.bielcrystal.com',
  topicId: 'tpc',
};

describe('spawnHeteroAgentRun', () => {
  beforeEach(() => {
    materializeSkillsForCliMock.mockResolvedValue({ errors: [] });
  });

  afterEach(() => {
    spawnMock.mockReset();
  });

  it('rejects a missing workspace without spawning', async () => {
    await expect(spawnHeteroAgentRun({ ...baseParams, cwd: undefined })).resolves.toEqual({
      reason: 'WORKSPACE_REQUIRED',
      status: 'rejected',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('materializes enabled skills before spawning and fails closed on an error', async () => {
    materializeSkillsForCliMock.mockResolvedValue({
      errors: [{ key: 'builtin:test', message: 'foreign skill directory' }],
    });

    await expect(
      spawnHeteroAgentRun({
        ...baseParams,
        skillPolicy: 'project',
        skills: [
          {
            content: '# Test',
            description: 'Test',
            identifier: 'test',
            key: 'builtin:test',
            name: 'test',
            source: 'builtin',
          },
        ],
      }),
    ).resolves.toEqual({
      reason: 'SKILL_MATERIALIZATION_FAILED: foreign skill directory',
      status: 'rejected',
    });
    expect(materializeSkillsForCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/work/dir', policy: 'project' }),
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns `lh hetero exec` in server-ingest mode via the current CLI entry', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      cwd: '/work/dir',
      jwt: 'jwt-token',
      operationId: 'op-1',
      topicId: 'tpc-1',
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    const [bin, args, opts] = spawnMock.mock.calls[0];

    expect(bin).toBe(process.execPath);
    expect(args).toEqual([
      ...process.execArgv,
      process.argv[1],
      'hetero',
      'exec',
      '--type',
      'claudeCode',
      '--operation-id',
      'op-1',
      '--topic',
      'tpc-1',
      '--render',
      'none',
      '--input-json',
      '-',
      '--cwd',
      '/work/dir',
    ]);
    expect(opts).toMatchObject({
      cwd: '/work/dir',
      env: expect.objectContaining({
        LOBEHUB_JWT: 'jwt-token',
        LOBEHUB_SERVER: 'https://aihub.bielcrystal.com',
      }),
    });

    // stdin is only written after the child actually spawns.
    expect(child.stdin.write).not.toHaveBeenCalled();
    child.emit('spawn');

    await expect(ackPromise).resolves.toEqual({ status: 'accepted' });
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify('hi'));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('rejects (no stuck run) when the child errors before spawning, e.g. bad cwd', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({ ...baseParams, cwd: '/missing' });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    child.emit('error', new Error('spawn ENOENT'));

    await expect(ackPromise).resolves.toEqual({ reason: 'spawn ENOENT', status: 'rejected' });
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it('appends --resume when resuming a session', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    void spawnHeteroAgentRun({ ...baseParams, resumeSessionId: 'sess-9' });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain('--resume');
    expect(args).toContain('sess-9');
  });

  it('sends a content-block array to stdin when systemContext is provided', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      prompt: 'do it',
      systemContext: 'workspace rules',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: 'workspace rules', type: 'text' },
        { text: 'do it', type: 'text' },
      ]),
    );
  });

  it('appends image blocks to stdin when imageList is provided', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ackPromise = spawnHeteroAgentRun({
      ...baseParams,
      imageList: [{ id: 'file-1', url: 'https://signed/a.png' }],
      prompt: 'look at this',
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    child.emit('spawn');
    await ackPromise;

    expect(child.stdin.write).toHaveBeenCalledWith(
      JSON.stringify([
        { text: 'look at this', type: 'text' },
        { source: { id: 'file-1', type: 'url', url: 'https://signed/a.png' }, type: 'image' },
      ]),
    );
  });

  it('preserves resolved env without allowing it to replace gateway auth', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    void spawnHeteroAgentRun({
      ...baseParams,
      env: { LOBEHUB_JWT: 'wrong', WORKSPACE_VALUE: 'kept' },
      jwt: 'trusted-jwt',
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    const [, , options] = spawnMock.mock.calls[0];
    expect(options.env).toMatchObject({
      LOBEHUB_JWT: 'trusted-jwt',
      WORKSPACE_VALUE: 'kept',
    });
  });

  it('loads env_files before spawn and lets server-resolved env win', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'masterino-agent-run-env-'));
    await writeFile(path.join(cwd, '.env'), 'FROM_FILE=1\nSHARED=file\n');
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const ack = spawnHeteroAgentRun({
      ...baseParams,
      cwd,
      env: { SHARED: 'server' },
      envFiles: ['.env'],
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    const [, , options] = spawnMock.mock.calls[0];
    expect(options.env).toMatchObject({ FROM_FILE: '1', SHARED: 'server' });
    child.emit('spawn');
    await ack;
    await rm(cwd, { force: true, recursive: true });
  });
});
