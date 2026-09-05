import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sandboxService = {
    callTool: vi.fn(),
    capabilities: {
      backgroundCommands: true,
      exportFile: true,
      files: true,
      languages: ['python'],
      persistentSession: true,
      shell: true,
      skillScripts: true,
    },
    exportAndUploadFile: vi.fn(),
    kind: 'onlyboxes',
  };

  return {
    checkHash: vi.fn(),
    createSandboxService: vi.fn(() => sandboxService),
    deviceExecuteToolCall: vi.fn(),
    deviceVerifySkillPaths: vi.fn(),
    prepareSkillPackage: vi.fn(),
    fileService: {
      getFullFileUrl: vi.fn(),
    },
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    getAgentSkills: vi.fn(),
    getUserSettings: vi.fn(),
    getSandboxProviderKind: vi.fn(() => 'onlyboxes'),
    marketService: {},
    marketServiceConstructor: vi.fn(),
    queryMessages: vi.fn(),
    readResource: vi.fn(),
    sandboxService,
  };
});

vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn(() => ({
    findAll: mocks.findAll,
    findById: mocks.findById,
    findByName: mocks.findByName,
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(() => ({ query: mocks.queryMessages })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    checkHash: mocks.checkHash,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(() => ({
    getUserSettings: mocks.getUserSettings,
  })),
}));

vi.mock('@/helpers/skillFilters', () => ({
  filterBuiltinSkills: vi.fn((skills: unknown) => skills),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeToolCall: mocks.deviceExecuteToolCall,
    verifySkillPaths: mocks.deviceVerifySkillPaths,
    prepareSkillPackage: mocks.prepareSkillPackage,
  },
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(() => ({
    getAgentSkills: mocks.getAgentSkills,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => mocks.fileService),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.marketServiceConstructor.mockImplementation(() => mocks.marketService),
}));

vi.mock('@/server/services/sandbox', async () => {
  const actual = await vi.importActual('@/server/services/sandbox');

  return {
    ...(actual as Record<string, unknown>),
    createSandboxService: mocks.createSandboxService,
    getSandboxProviderKind: mocks.getSandboxProviderKind,
  };
});

vi.mock('@/server/services/skill/resource', () => ({
  SkillResourceService: vi.fn(() => ({
    readResource: mocks.readResource,
  })),
}));

const activation = (id: string, name: string) => ({
  role: 'tool',
  plugin: { identifier: 'lobe-skills', apiName: 'activateSkill' },
  pluginState: { id, name },
});

describe('skillsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkHash.mockResolvedValue({ isExist: true, url: 'skills/user-skill.zip' });
    mocks.fileService.getFullFileUrl.mockResolvedValue('https://files.example.com/user-skill.zip');
    mocks.findAll.mockResolvedValue({ data: [], total: 0 });
    mocks.findById.mockResolvedValue(undefined);
    mocks.findByName.mockImplementation(async (name: string) => {
      if (name === 'user-skill') {
        return {
          id: 'user-skill-id',
          name: 'user-skill',
          zipFileHash: 'zip-hash-1',
        };
      }

      return undefined;
    });
    mocks.getAgentSkills.mockResolvedValue([]);
    mocks.queryMessages.mockResolvedValue([activation('project:deploy', 'deploy')]);
    mocks.getUserSettings.mockResolvedValue({ market: { accessToken: 'market-token' } });
    mocks.deviceVerifySkillPaths.mockImplementation(async ({ skillDir, workspaceRoot }) => ({
      skillDir,
      workspaceRoot,
    }));
    mocks.deviceExecuteToolCall.mockResolvedValue({
      content: 'ok',
      state: { exitCode: 0, output: 'device ok', success: true },
      success: true,
    });
    mocks.sandboxService.callTool.mockResolvedValue({
      result: {
        exitCode: 0,
        output: 'ok',
        stdout: 'ok',
        success: true,
      },
      success: true,
    });
  });

  it('executes scripts through the sandbox service and only attaches persisted skill zips', async () => {
    mocks.queryMessages.mockResolvedValue([
      activation('user-skill-id', 'user-skill'),
      activation('builtin-skill-id', 'builtin-skill'),
    ]);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [
        { id: 'user-skill-id', name: 'user-skill' },
        { id: 'builtin-skill-id', name: 'builtin-skill' },
      ],
      command: 'python scripts/run.py',
      description: 'Run skill script',
    });

    expect(result.success).toBe(true);
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
    expect(mocks.marketServiceConstructor).not.toHaveBeenCalled();
    expect(mocks.findByName).toHaveBeenCalledWith('user-skill');
    expect(mocks.findByName).toHaveBeenCalledWith('builtin-skill');
    expect(mocks.checkHash).toHaveBeenCalledWith('zip-hash-1');
    expect(mocks.sandboxService.callTool).toHaveBeenCalledWith(
      'execScript',
      expect.objectContaining({
        command: 'python scripts/run.py',
        description: 'Run skill script',
        skillZipUrls: {
          'user-skill': 'https://files.example.com/user-skill.zip',
        },
      }),
    );
  }, 60_000);

  it('injects the frozen device context, verifies paths, and never creates a sandbox', async () => {
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      executionContext: {
        cwd: '/repo',
        env: { secretKeys: [], sources: {}, values: { TOKEN: 'value' } },
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/repo',
        },
      },
      operationId: 'operation-1',
      projectSkills: [{ location: '/repo/.agents/skills/deploy/SKILL.md', name: 'deploy' }],
      serverDB: {} as never,
      skillRegistryResult: {
        entries: [],
        errors: [],
        policy: {
          includeAgentSkills: true,
          includeProjectSkills: true,
          includeUserSkills: true,
          materializeForHeteroCli: 'off',
          pinned: [],
        },
        precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
        skills: [
          {
            description: 'Deploy',
            identifier: 'project:deploy',
            key: 'project:project:deploy',
            location: '/repo/.agents/skills/deploy/SKILL.md',
            name: 'deploy',
            scope: 'project',
            source: 'project',
          },
        ],
      },
      toolCallId: 'tool-call-1',
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [{ id: 'project:deploy', name: 'deploy' }],
      command: './scripts/deploy.sh',
      description: 'Deploy',
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.deviceVerifySkillPaths).toHaveBeenCalledWith({
      deviceId: 'device-1',
      skillDir: '/repo/.agents/skills/deploy',
      userId: 'user-1',
      workspaceRoot: '/repo',
    });
    expect(mocks.deviceExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'device-1',
        executionContext: expect.objectContaining({
          cwd: '/repo/.agents/skills/deploy',
          env: {
            SKILL_DIR: '/repo/.agents/skills/deploy',
            TOKEN: 'value',
            WORKSPACE_DIR: '/repo',
          },
          workspaceRootPath: '/repo',
        }),
        operationId: 'operation-1',
        toolCallId: 'tool-call-1',
      }),
      expect.objectContaining({ apiName: 'runCommand', identifier: 'lobe-local-system' }),
      undefined,
    );
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });

  it('prepares a user ZIP from persisted activations on the frozen device before executing its script', async () => {
    mocks.queryMessages.mockResolvedValue([
      activation('project:old', 'old-project'),
      activation('skill-1', 'user-skill'),
      activation('builtin:docs', 'documentation-only'),
    ]);
    const { skillsRuntime } = await import('../skills');
    mocks.findById.mockImplementation(async (id: string) =>
      id === 'skill-1' ? { id, name: 'user-skill', zipFileHash: 'hash-1' } : undefined,
    );
    mocks.prepareSkillPackage.mockResolvedValue({ extractedDir: '/cache/skills/hash-1' });
    mocks.deviceVerifySkillPaths.mockResolvedValue({
      skillDir: '/cache/skills/hash-1',
      workspaceRoot: '/repo',
    });
    mocks.deviceExecuteToolCall.mockResolvedValue({ content: 'ok', success: true });
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      toolManifestMap: {},
      userId: 'user-1',
      serverDB: {} as any,
      operationId: 'operation-1',
      topicId: 'topic-1',
      toolCallId: 'call-1',
      projectSkills: [{ location: '/repo/.agents/skills/old/SKILL.md', name: 'old-project' }],
      executionContext: {
        version: 1,
        operationId: 'operation-1',
        plan: { kind: 'device', target: 'device', deviceId: 'device-1' },
        cwd: '/repo',
        workspace: { id: 'workspace-1', deviceId: 'device-1', kind: 'device', rootPath: '/repo' },
        envFiles: ['.env'],
      },
    });
    expect(
      (
        await runtime.execScript({
          command: 'python scripts/check.py',
          description: 'check',
          activatedSkills: [{ id: 'forged', name: 'not-activated' }],
        })
      ).success,
    ).toBe(true);
    expect(mocks.prepareSkillPackage).toHaveBeenCalledWith({
      deviceId: 'device-1',
      userId: 'user-1',
      zipHash: 'hash-1',
      url: 'https://files.example.com/user-skill.zip',
    });
    expect(mocks.deviceExecuteToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          cwd: '/cache/skills/hash-1',
          workspaceRootPath: '/repo',
          envFiles: ['.env'],
        }),
      }),
      expect.anything(),
      undefined,
    );
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });

  it('fails closed when device path verification is unavailable', async () => {
    mocks.deviceVerifySkillPaths.mockResolvedValue(undefined);
    const { skillsRuntime } = await import('../skills');
    const runtime = await skillsRuntime.factory({
      activeDeviceId: 'device-1',
      executionContext: {
        cwd: '/repo',
        plan: { deviceId: 'device-1', kind: 'device', target: 'device' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          id: 'workspace-1',
          kind: 'device',
          rootPath: '/repo',
        },
      },
      projectSkills: [{ location: '/repo/.agents/skills/deploy/SKILL.md', name: 'deploy' }],
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.execScript({
      activatedSkills: [{ id: 'project:deploy', name: 'deploy' }],
      command: './scripts/deploy.sh',
      description: 'Deploy',
    });

    expect(result).toMatchObject({ state: { errorCode: 'WORKSPACE_REQUIRED' }, success: false });
    expect(mocks.deviceExecuteToolCall).not.toHaveBeenCalled();
    expect(mocks.createSandboxService).not.toHaveBeenCalled();
  });
});
