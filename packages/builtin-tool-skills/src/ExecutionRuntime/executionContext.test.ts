import type { LocalExecutionContextSnapshot } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { type SkillRuntimeService, SkillsExecutionRuntime } from './index';

const createMockService = (overrides: Partial<SkillRuntimeService>): SkillRuntimeService => ({
  findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(undefined),
  findByName: vi.fn().mockResolvedValue(undefined),
  readResource: vi.fn(),
  ...overrides,
});

describe('SkillsExecutionRuntime execution context', () => {
  it('passes one frozen execution context to execScript and runCommand services', async () => {
    const executionContext: LocalExecutionContextSnapshot = {
      createdAt: '2026-09-01T00:00:00.000Z',
      environment: {
        inherited: 'all',
        overriddenKeys: [],
        pathEntryCount: 1,
        removedKeys: [],
      },
      ref: { contextId: 'context-skills', version: 1 },
      runtimePlan: {
        runtime: 'node',
        runtimeCapability: { available: true },
        runtimeSource: 'default',
        status: 'ready',
      },
      workspace: {
        realPath: '/workspace',
        source: 'selected',
        writableRoots: ['/workspace'],
      },
    };
    const execScript = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', success: true });
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', success: true });
    const runtime = new SkillsExecutionRuntime({
      service: createMockService({ execScript, runCommand }),
    });

    await runtime.execScript(
      { command: 'node task.js', description: 'run task' },
      executionContext,
    );
    await runtime.runCommand({ command: 'node task.js' }, executionContext);

    expect(execScript).toHaveBeenCalledWith('node task.js', {
      activatedSkills: undefined,
      description: 'run task',
      executionContext,
    });
    expect(runCommand).toHaveBeenCalledWith({ command: 'node task.js', executionContext });
  });
});
