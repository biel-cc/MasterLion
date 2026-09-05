import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadWorkspaceEnvFiles } from './workspaceEnvFiles';

describe('loadWorkspaceEnvFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'masterino-env-files-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('loads workspace-relative dotenv files in list order', async () => {
    await writeFile(path.join(root, '.env'), 'FROM_FILE=1\nSHARED=first\n');
    await writeFile(path.join(root, '.env.local'), 'SHARED=second\nQUOTED="hello world"\n');

    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['.env', '.env.local'], workspaceRootPath: root }),
    ).resolves.toEqual({ FROM_FILE: '1', QUOTED: 'hello world', SHARED: 'second' });
  });

  it('accepts uppercase keys and rejects lowercase keys', async () => {
    await writeFile(path.join(root, '.env.upper'), 'UPPER_KEY=value\n');
    await writeFile(path.join(root, '.env.lower'), 'lowercase=value\n');

    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['.env.upper'], workspaceRootPath: root }),
    ).resolves.toEqual({ UPPER_KEY: 'value' });
    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['.env.lower'], workspaceRootPath: root }),
    ).rejects.toThrow(/invalid workspace environment variable/i);
  });

  it('rejects absolute, traversal, and symlink escapes', async () => {
    const outside = `${root}-outside`;
    await mkdir(outside);
    await writeFile(path.join(outside, '.env'), 'SECRET=escaped');
    await symlink(path.join(outside, '.env'), path.join(root, 'linked.env'));

    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['/tmp/.env'], workspaceRootPath: root }),
    ).rejects.toThrow(/relative/i);
    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['../.env'], workspaceRootPath: root }),
    ).rejects.toThrow(/workspace/i);
    await expect(
      loadWorkspaceEnvFiles({ envFiles: ['linked.env'], workspaceRootPath: root }),
    ).rejects.toThrow(/workspace/i);

    await rm(outside, { force: true, recursive: true });
  });
});
