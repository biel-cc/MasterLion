import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ExecutionContextError } from './ExecutionContextManager';
import { ExecutionContextManager } from './ExecutionContextManager';

const tempDirs: string[] = [];

const createTempDir = async (prefix: string) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const createManager = async (options?: {
  environment?: NodeJS.ProcessEnv;
  environmentPlatform?: NodeJS.Platform;
  tools?: Partial<Record<'bun' | 'node' | 'npm' | 'pnpm' | 'python' | 'uv', string>>;
}) => {
  const managedWorkspaceRoot = await createTempDir('masterino-managed-');
  const versions = options?.tools ?? { node: 'v22.18.0', npm: '10.9.3' };

  return new ExecutionContextManager({
    baseEnvironment: () => options?.environment ?? { HOME: '/safe/home', PATH: '/safe/bin' },
    detectTool: async (tool) => {
      const version = versions[tool as keyof typeof versions];
      return version
        ? { available: true, executablePath: `/tools/${tool}`, version }
        : { available: false };
    },
    managedWorkspaceRoot,
    environmentPlatform: options?.environmentPlatform,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    randomId: () => 'context-1',
  });
};

describe('ExecutionContextManager', () => {
  it('freezes one canonical selected workspace and environment for prompt, paths, and commands', async () => {
    const selected = await createTempDir('masterino-selected-');
    const manager = await createManager({
      environment: {
        HOME: '/safe/home',
        MASTERINO_SECRET: 'do-not-publish',
        PATH: '/usr/local/bin:/usr/bin',
      },
    });

    const prepared = await manager.prepare({
      environmentPolicy: { exclude: ['MASTERINO_SECRET'], set: { CI: '1' } },
      requestedWorkingDirectory: selected,
      topicId: 'topic-a',
      workload: { kind: 'javascript' },
    });

    expect(prepared).toEqual({
      createdAt: '2026-09-01T00:00:00.000Z',
      environment: {
        inherited: 'all',
        overriddenKeys: ['CI'],
        pathEntryCount: 2,
        removedKeys: ['MASTERINO_SECRET'],
      },
      ref: { contextId: 'context-1', version: 1 },
      runtimePlan: {
        packageManager: 'npm',
        packageManagerCapability: { available: true, version: '10.9.3' },
        packageManagerSource: 'default',
        runtime: 'node',
        runtimeCapability: { available: true, version: 'v22.18.0' },
        runtimeSource: 'default',
        status: 'ready',
      },
      workspace: {
        realPath: await realpath(selected),
        source: 'selected',
        writableRoots: [await realpath(selected)],
      },
    });

    await expect(manager.resolvePath(prepared.ref, 'reports/result.md', 'write')).resolves.toBe(
      path.join(await realpath(selected), 'reports/result.md'),
    );
    expect(
      await manager.resolveCommand(prepared.ref, {
        command: 'pwd',
        cwd: '/wrong',
        env: { PATH: '/wrong' },
      }),
    ).toMatchObject({
      command: 'pwd',
      cwd: await realpath(selected),
      env: { CI: '1', HOME: '/safe/home', PATH: '/usr/local/bin:/usr/bin' },
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.environment.overriddenKeys)).toBe(true);
    expect(Object.isFrozen(prepared.runtimePlan.runtimeCapability)).toBe(true);
    expect(Object.isFrozen(prepared.workspace.writableRoots)).toBe(true);
  });

  it('creates a stable managed workspace instead of falling back to process.cwd()', async () => {
    const manager = await createManager();

    const first = await manager.prepare({ agentId: 'agent-a', topicId: 'topic-a' });
    const second = await manager.prepare({ agentId: 'agent-a', topicId: 'topic-a' });

    expect(first.workspace.source).toBe('managed');
    expect(first.workspace.realPath).toBe(second.workspace.realPath);
    expect(first.workspace.realPath).not.toBe(process.cwd());
  });

  it('isolates concurrent new Topics until each persists its managed workspace', async () => {
    const manager = await createManager();

    const first = await manager.prepare({ agentId: 'agent-a', operationId: 'operation-a' });
    const second = await manager.prepare({ agentId: 'agent-a', operationId: 'operation-b' });

    expect(first.workspace.realPath).not.toBe(second.workspace.realPath);
  });

  it('normalizes Windows Path and policy keys before preflight and command execution', async () => {
    const selected = await createTempDir('masterino-windows-env-');
    const detectedEnvironments: Record<string, string>[] = [];
    const managedWorkspaceRoot = await createTempDir('masterino-managed-');
    const manager = new ExecutionContextManager({
      baseEnvironment: () => ({
        Home: 'C:\\Users\\masterino',
        Path: 'C:\\node;C:\\python',
        Secret_Token: 'do-not-inherit',
      }),
      detectTool: async (_tool, environment) => {
        detectedEnvironments.push(environment);
        return { available: false };
      },
      environmentPlatform: 'win32',
      managedWorkspaceRoot,
    });

    const prepared = await manager.prepare({
      environmentPolicy: {
        exclude: ['secret_token'],
        include: ['path'],
        inherit: 'core',
        set: { custom_flag: '1' },
      },
      requestedWorkingDirectory: selected,
      workload: { kind: 'shell' },
    });

    expect(detectedEnvironments).toHaveLength(8);
    expect(detectedEnvironments[0]).toEqual({
      CUSTOM_FLAG: '1',
      HOME: 'C:\\Users\\masterino',
      PATH: 'C:\\node;C:\\python',
    });
    expect(prepared.environment).toEqual({
      inherited: 'core',
      overriddenKeys: ['CUSTOM_FLAG'],
      pathEntryCount: 2,
      removedKeys: ['SECRET_TOKEN'],
    });
    await expect(
      manager.resolveCommand(prepared.ref, { command: 'where node' }),
    ).resolves.toMatchObject({
      env: {
        CUSTOM_FLAG: '1',
        HOME: 'C:\\Users\\masterino',
        PATH: 'C:\\node;C:\\python',
      },
    });
  });

  it('selects runtime and package manager independently without using Bun as a missing Node substitute', async () => {
    const project = await createTempDir('masterino-node-project-');
    await writeFile(
      path.join(project, 'package.json'),
      JSON.stringify({ engines: { node: '>=20' }, packageManager: 'pnpm@9.0.0' }),
    );
    const manager = await createManager({ tools: { bun: '1.2.20', pnpm: '9.0.0' } });

    const prepared = await manager.prepare({
      requestedWorkingDirectory: project,
      workload: { bunCompatible: false, kind: 'javascript' },
    });

    expect(prepared.runtimePlan).toMatchObject({
      packageManager: 'pnpm',
      packageManagerCapability: { available: true },
      packageManagerSource: 'project',
      runtime: 'node',
      runtimeCapability: { available: false },
      runtimeSource: 'project',
      status: 'missing',
    });
  });

  it('treats a Bun lockfile as package-manager intent, not runtime permission', async () => {
    const project = await createTempDir('masterino-bun-package-manager-');
    await writeFile(path.join(project, 'bun.lock'), '');
    const manager = await createManager({ tools: { bun: '1.2.20', node: 'v22.18.0' } });

    const prepared = await manager.prepare({
      requestedWorkingDirectory: project,
      workload: { bunCompatible: false, kind: 'javascript' },
    });

    expect(prepared.runtimePlan).toMatchObject({
      packageManager: 'bun',
      packageManagerSource: 'lockfile',
      runtime: 'node',
      runtimeSource: 'default',
      status: 'ready',
    });
  });

  it('fails closed when a selected workspace disappears or a path escapes through a symlink', async () => {
    const selected = await createTempDir('masterino-closed-');
    const outside = await createTempDir('masterino-outside-');
    await mkdir(path.join(selected, 'safe'));
    await symlink(outside, path.join(selected, 'escape'));
    const manager = await createManager();
    const prepared = await manager.prepare({ requestedWorkingDirectory: selected });

    await expect(
      manager.resolvePath(prepared.ref, 'escape/stolen.txt', 'write'),
    ).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(
      manager.resolvePath(prepared.ref, path.join(selected, 'safe', 'inside.txt'), 'write'),
    ).resolves.toBe(path.join(await realpath(selected), 'safe', 'inside.txt'));
    await expect(
      manager.resolvePath(prepared.ref, path.join(outside, 'outside.txt'), 'write'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });

    await rm(selected, { recursive: true });
    await expect(manager.resolveCommand(prepared.ref, { command: 'pwd' })).rejects.toEqual(
      expect.objectContaining<Partial<ExecutionContextError>>({ code: 'WORKSPACE_UNAVAILABLE' }),
    );
  });

  it('invalidates references on close', async () => {
    const manager = await createManager();
    const prepared = await manager.prepare({ topicId: 'topic-close' });

    await expect(manager.close(prepared.ref)).resolves.toEqual({ closed: true });
    await expect(manager.inspect(prepared.ref)).rejects.toMatchObject({
      code: 'CONTEXT_NOT_FOUND',
    });
  });
});
