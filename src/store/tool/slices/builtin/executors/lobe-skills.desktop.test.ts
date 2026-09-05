import { selectActivatedSkillsFromMessages } from '@lobechat/builtin-tool-skills';
import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { skillsExecutor } from './lobe-skills.desktop';

const { executeLocalToolCall, resolveExecutionDirectory, resolveRealPath } = vi.hoisted(() => ({
  executeLocalToolCall: vi.fn(),
  resolveExecutionDirectory: vi.fn(),
  resolveRealPath: vi.fn(),
}));

vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { executeLocalToolCall },
}));
vi.mock('@/services/electron/desktopSkillRuntime', () => ({
  desktopSkillRuntimeService: {
    resolveExecutionDirectory,
    resolveReferenceFullPath: vi.fn(),
  },
}));
vi.mock('@/services/electron/localFileService', () => ({
  localFileService: { resolveRealPath },
}));
vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: vi.fn(),
    getByName: vi.fn(),
    list: vi.fn(),
    readResource: vi.fn(),
  },
}));

const context = {
  agentId: 'agent-a',
  executionContext: {
    accessRoots: [
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/workspace/project',
        scope: 'primary',
        source: 'workspace',
      },
    ],
    cwd: '/workspace/project',
    envFiles: ['.env'],
    operationId: 'operation-a',
    plan: { deviceId: 'device-a', kind: 'device', target: 'local' },
    version: 1,
    workspace: {
      deviceId: 'device-a',
      id: 'workspace-a',
      kind: 'device',
      rootPath: '/workspace/project',
    },
  },
  messageId: 'message-a',
  operationId: 'operation-a',
  toolCallId: 'call-a',
  topicId: 'topic-a',
} satisfies BuiltinToolContext;

describe('desktop skills execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeLocalToolCall.mockResolvedValue({ content: 'ok', success: true });
    resolveRealPath.mockImplementation(async ({ path }: { path: string }) => ({
      path,
      success: true,
    }));
  });

  it('activates and reads references using frozen project file access', async () => {
    const skill = {
      description: 'test',
      identifier: 'demo',
      key: 'project:demo',
      location: '/workspace/project/.agents/skills/demo/SKILL.md',
      name: 'demo',
      scope: 'project' as const,
      source: 'project' as const,
    };
    const ctx = { ...context, operationSkills: [skill] };
    executeLocalToolCall.mockImplementation(async ({ apiName }: { apiName: string }) =>
      apiName === 'globFiles'
        ? { content: 'Found 1 file', state: { files: ['references/readme.md'] }, success: true }
        : { content: 'Reference content', success: true },
    );
    const activation = await skillsExecutor.activateSkill({ name: 'demo' }, ctx);
    expect(activation.success).toBe(true);
    const activatedSkills = selectActivatedSkillsFromMessages([
      {
        plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
        pluginState: activation.state,
        role: 'tool',
      },
    ]);
    expect(activatedSkills).toEqual([
      expect.objectContaining({ id: 'project:demo', name: 'demo' }),
    ]);
    expect(
      (
        await skillsExecutor.execScript(
          { command: 'sh scripts/probe.sh' },
          {
            ...ctx,
            stepContext: { activatedSkills },
          },
        )
      ).success,
    ).toBe(true);
    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/workspace/project/.agents/skills/demo',
          workspaceRootPath: '/workspace/project',
          envFiles: ['.env'],
        }),
      }),
    );
    expect(
      (await skillsExecutor.readReference({ id: 'demo', path: 'references/readme.md' }, ctx))
        .success,
    ).toBe(true);
    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'readFile',
        args: expect.objectContaining({
          path: '/workspace/project/.agents/skills/demo/references/readme.md',
        }),
        trace: expect.objectContaining({ deviceId: 'device-a', operationId: 'operation-a' }),
      }),
    );
    executeLocalToolCall.mockClear();
    expect(
      (await skillsExecutor.readReference({ id: 'demo', path: '../secret' }, ctx)).success,
    ).toBe(false);
    expect(executeLocalToolCall).not.toHaveBeenCalled();
  });

  it('runs a general skill command in the frozen workspace through main process', async () => {
    await skillsExecutor.runCommand({ command: 'pwd' }, context);

    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/workspace/project',
          envRef: {
            agentId: 'agent-a',
            topicId: 'topic-a',
            workspaceId: 'workspace-a',
          },
          workspaceRootPath: '/workspace/project',
        }),
        purpose: 'skill-command',
      }),
    );
  });

  it('runs an activated skill script from its prepared cache directory', async () => {
    resolveExecutionDirectory.mockResolvedValue('/managed/skills/hash-a');

    await skillsExecutor.execScript(
      { command: './run.sh', description: 'run it' },
      {
        ...context,
        stepContext: {
          activatedSkills: [{ id: 'skill-a', name: 'skill-a' }],
        },
      },
    );

    expect(executeLocalToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        apiName: 'runCommand',
        executionContext: expect.objectContaining({
          cwd: '/managed/skills/hash-a',
          workspaceRootPath: '/workspace/project',
        }),
        purpose: 'skill-script',
      }),
    );
  });
});
