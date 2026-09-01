import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skillsExecutor } from './lobe-skills.desktop';

const mocks = vi.hoisted(() => ({
  resolveExecutionDirectory: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock('@lobechat/builtin-skills', () => ({ builtinSkills: [] }));
vi.mock('@/helpers/skillFilters', () => ({ filterBuiltinSkills: () => [] }));
vi.mock('@/services/electron/desktopSkillRuntime', () => ({
  desktopSkillRuntimeService: {
    resolveExecutionDirectory: mocks.resolveExecutionDirectory,
    resolveReferenceFullPath: vi.fn(),
  },
}));
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { runCommand: mocks.runCommand },
}));
vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn(),
    readResource: vi.fn(),
  },
}));

describe('desktop Skills execution context', () => {
  beforeEach(() => {
    mocks.resolveExecutionDirectory.mockReset();
    mocks.runCommand.mockReset();
  });

  it('prepares Skill assets but delegates authoritative cwd/env to the context reference', async () => {
    mocks.resolveExecutionDirectory.mockResolvedValue('/prepared/skill-assets');
    mocks.runCommand.mockResolvedValue({ exit_code: 0, stdout: 'ok', success: true });
    const executionContext = {
      createdAt: '2026-09-01T00:00:00.000Z',
      environment: {
        inherited: 'all' as const,
        overriddenKeys: [],
        pathEntryCount: 1,
        removedKeys: [],
      },
      ref: { contextId: 'ctx-skill', version: 1 as const },
      runtimePlan: {
        runtime: 'node' as const,
        runtimeCapability: { available: true },
        runtimeSource: 'default' as const,
        status: 'ready' as const,
      },
      workspace: {
        realPath: '/workspace/topic',
        source: 'selected' as const,
        writableRoots: ['/workspace/topic'],
      },
    };

    await skillsExecutor.invoke(
      'execScript',
      { command: 'node scripts/report.js', description: 'Generate report' },
      {
        executionContext,
        messageId: 'tool-message-1',
        stepContext: {
          activatedSkills: [{ id: 'skill-1', name: 'Report skill' }],
        },
      },
    );

    expect(mocks.resolveExecutionDirectory).toHaveBeenCalledWith([
      { description: undefined, id: 'skill-1', name: 'Report skill' },
    ]);
    expect(mocks.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'node scripts/report.js',
        cwd: '/prepared/skill-assets',
      }),
      executionContext.ref,
    );
  });
});
