import type { ExecutionContext } from '@lobechat/types/src/executionContext';
import { describe, expect, it } from 'vitest';

import { resolveSkillScriptExecutionRoute } from './skillScriptRoute';

describe('resolveSkillScriptExecutionRoute', () => {
  it('routes device scripts through the primary workspace with skill environment variables', () => {
    const context: ExecutionContext = {
      cwd: '/repo',
      env: { secretKeys: [], sources: { TOKEN: 'agent' }, values: { TOKEN: 'safe-value' } },
      plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
      version: 1,
      workspace: { deviceId: 'device-1', id: 'workspace-1', kind: 'device', rootPath: '/repo' },
    };

    expect(
      resolveSkillScriptExecutionRoute({
        context,
        skillDir: '/repo/.agents/skills/release-writer',
      }),
    ).toEqual({
      cwd: '/repo',
      deviceId: 'device-1',
      env: {
        SKILL_DIR: '/repo/.agents/skills/release-writer',
        TOKEN: 'safe-value',
        WORKSPACE_DIR: '/repo',
      },
      kind: 'device',
      ok: true,
    });
  });

  it('preserves the existing sandbox execution path without cwd or env overrides', () => {
    const context: ExecutionContext = {
      cwd: '/workspace',
      plan: { kind: 'sandbox', target: 'sandbox' },
      version: 1,
      workspace: { kind: 'sandbox', rootPath: '/workspace' },
    };

    expect(resolveSkillScriptExecutionRoute({ context, skillDir: '/workspace/skills/a' })).toEqual({
      kind: 'sandbox',
      ok: true,
    });
  });

  it('returns WORKSPACE_REQUIRED when execution is disabled', () => {
    const context: ExecutionContext = {
      plan: { kind: 'none', target: 'none' },
      unresolvedReason: 'target-none',
      version: 1,
    };

    expect(resolveSkillScriptExecutionRoute({ context })).toEqual({
      error: {
        code: 'WORKSPACE_REQUIRED',
        message: 'A workspace is required to execute a skill script.',
      },
      ok: false,
    });
  });

  it('rejects a skill directory outside the primary workspace', () => {
    const context: ExecutionContext = {
      cwd: '/repo',
      plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
      version: 1,
      workspace: { deviceId: 'device-1', kind: 'device', rootPath: '/repo' },
    };

    expect(resolveSkillScriptExecutionRoute({ context, skillDir: '/other/skill' })).toMatchObject({
      error: { code: 'WORKSPACE_REQUIRED' },
      ok: false,
    });
  });
});
