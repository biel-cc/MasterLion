import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { SkillsExecutionRuntime } from '../ExecutionRuntime';
import { SkillsExecutor } from './index';

describe('SkillsExecutor runtime context', () => {
  it('resolves a runtime from the immutable builtin tool context for every call', async () => {
    const runCommand = vi.fn(async () => ({ content: 'ok', success: true }));
    const runtimeFactory = vi.fn(() => ({ runCommand }) as unknown as SkillsExecutionRuntime);
    const executor = new SkillsExecutor(runtimeFactory);
    const ctx = {
      executionContext: {
        accessRoots: [],
        cwd: '/workspace/project',
        plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
        version: 1,
      },
      messageId: 'message-a',
    } satisfies BuiltinToolContext;

    await expect(executor.runCommand({ command: 'pwd' }, ctx)).resolves.toMatchObject({
      content: 'ok',
      success: true,
    });

    expect(runtimeFactory).toHaveBeenCalledWith(ctx);
    expect(runCommand).toHaveBeenCalledWith({ command: 'pwd' });
  });
});
