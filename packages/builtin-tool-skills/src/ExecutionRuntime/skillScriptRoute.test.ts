import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { describe, expect, it, vi } from 'vitest';

import { resolveSkillScriptExecutionRoute } from './skillScriptRoute';

const deviceContext = (rootPath = '/repo'): ExecutionContext => ({
  cwd: rootPath,
  env: { secretKeys: [], sources: { TOKEN: 'agent' }, values: { TOKEN: 'safe-value' } },
  plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
  version: 1,
  workspace: { deviceId: 'device-1', id: 'workspace-1', kind: 'device', rootPath },
});

describe('resolveSkillScriptExecutionRoute', () => {
  it('routes verified device paths through the primary workspace', async () => {
    const verifyDevicePaths = vi.fn().mockResolvedValue({
      skillDir: '/real/repo/.agents/skills/release-writer',
      workspaceRoot: '/real/repo',
    });

    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext(),
        skillDir: '/repo/.agents/skills/release-writer',
        verifyDevicePaths,
      }),
    ).resolves.toEqual({
      cwd: '/real/repo/.agents/skills/release-writer',
      deviceId: 'device-1',
      env: {
        SKILL_DIR: '/real/repo/.agents/skills/release-writer',
        TOKEN: 'safe-value',
        WORKSPACE_DIR: '/real/repo',
      },
      kind: 'device',
      ok: true,
    });
    expect(verifyDevicePaths).toHaveBeenCalledWith({
      deviceId: 'device-1',
      skillDir: '/repo/.agents/skills/release-writer',
      workspaceRoot: '/repo',
    });
  });

  it('allows a device-verified managed skill cache while keeping the workspace identity', async () => {
    await expect(
      resolveSkillScriptExecutionRoute({
        allowExternalSkillDir: true,
        context: deviceContext(),
        skillDir: '/managed/skills/hash-a',
        verifyDevicePaths: async () => ({
          skillDir: '/real/managed/skills/hash-a',
          workspaceRoot: '/real/repo',
        }),
      }),
    ).resolves.toMatchObject({
      cwd: '/real/managed/skills/hash-a',
      env: {
        SKILL_DIR: '/real/managed/skills/hash-a',
        WORKSPACE_DIR: '/real/repo',
      },
      kind: 'device',
      ok: true,
    });
  });

  it('preserves the existing sandbox execution path without verification or overrides', async () => {
    const context: ExecutionContext = {
      cwd: '/workspace',
      plan: { kind: 'sandbox', target: 'sandbox' },
      version: 1,
      workspace: { kind: 'sandbox', rootPath: '/workspace' },
    };

    await expect(
      resolveSkillScriptExecutionRoute({ context, skillDir: '/workspace/skills/a' }),
    ).resolves.toEqual({ kind: 'sandbox', ok: true });
  });

  it('returns WORKSPACE_REQUIRED when execution is disabled', async () => {
    const context: ExecutionContext = {
      plan: { kind: 'none', target: 'none' },
      unresolvedReason: 'target-none',
      version: 1,
    };

    await expect(resolveSkillScriptExecutionRoute({ context })).resolves.toEqual({
      error: {
        code: 'WORKSPACE_REQUIRED',
        message: 'A workspace is required to execute a skill script.',
      },
      ok: false,
    });
  });

  it('rejects a skill directory outside the primary workspace before verification', async () => {
    const verifyDevicePaths = vi.fn();

    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext(),
        skillDir: '/other/skill',
        verifyDevicePaths,
      }),
    ).resolves.toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' }, ok: false });
    expect(verifyDevicePaths).not.toHaveBeenCalled();
  });

  it.each([
    '/repo/.agents/skills/../private',
    '/repo/./.agents/skills/deploy',
    'C:\\repo\\.agents\\skills\\..\\private',
    'C:\\repo\\.\\agents\\skills\\deploy',
  ])('rejects dot-segment traversal before device verification: %s', async (skillDir) => {
    const windows = skillDir.startsWith('C:');
    const verifyDevicePaths = vi.fn();

    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext(windows ? 'C:\\repo' : '/repo'),
        skillDir,
        verifyDevicePaths,
      }),
    ).resolves.toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' }, ok: false });
    expect(verifyDevicePaths).not.toHaveBeenCalled();
  });

  it('rejects device routing when no realpath verifier is wired', async () => {
    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext(),
        skillDir: '/repo/.agents/skills/deploy',
      }),
    ).resolves.toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' }, ok: false });
  });

  it('rejects a symlink escape reported by the device realpath verifier', async () => {
    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext(),
        skillDir: '/repo/.agents/skills/deploy',
        verifyDevicePaths: async () => ({
          skillDir: '/private/linked-skill',
          workspaceRoot: '/repo',
        }),
      }),
    ).resolves.toMatchObject({ error: { code: 'WORKSPACE_REQUIRED' }, ok: false });
  });

  it('canonicalizes and compares verified Windows paths case-insensitively', async () => {
    await expect(
      resolveSkillScriptExecutionRoute({
        context: deviceContext('C:\\Repo'),
        skillDir: 'c:\\repo\\.agents\\skills\\deploy',
        verifyDevicePaths: async () => ({
          skillDir: 'c:\\real-repo\\.agents\\skills\\deploy',
          workspaceRoot: 'C:\\REAL-REPO',
        }),
      }),
    ).resolves.toMatchObject({
      cwd: 'C:/real-repo/.agents/skills/deploy',
      env: {
        SKILL_DIR: 'C:/real-repo/.agents/skills/deploy',
        TOKEN: 'safe-value',
        WORKSPACE_DIR: 'C:/REAL-REPO',
      },
      kind: 'device',
      ok: true,
    });
  });
});
