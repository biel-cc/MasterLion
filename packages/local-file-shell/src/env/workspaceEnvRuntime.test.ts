import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareToolCallExecution } from '../file/executionBoundary';
import { ShellProcessManager } from '../shell/process-manager';
import { runCommand } from '../shell/runner';

describe('workspace env_files runtime seam', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'masterino-env-runtime-')));
  });

  afterEach(async () => {
    await rm(workspace, { force: true, recursive: true });
  });

  it('reaches the actual device child process and lets server env override dotenv', async () => {
    await writeFile(path.join(workspace, '.env'), 'FROM_FILE=1\nSHARED=file\n');
    const prepared = await prepareToolCallExecution({
      apiName: 'runCommand',
      args: {
        command: `printf '%s:%s' "$FROM_FILE" "$SHARED"`,
        cwd: workspace,
      },
      context: {
        accessRoots: [
          {
            modes: ['exec'],
            rootPath: workspace,
            scope: 'primary',
            source: 'workspace',
          },
        ],
        cwd: workspace,
        env: { SHARED: 'server' },
        envFiles: ['.env'],
        workspaceKind: 'device',
        workspaceRootPath: workspace,
      },
    });

    const result = await runCommand(prepared.args, {
      processManager: new ShellProcessManager(),
    });

    expect(result).toMatchObject({ exit_code: 0, stdout: '1:server', success: true });
  });
});
