import type * as LobechatConstModule from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getManagedEnvSummary = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConstModule>()),
  isDesktop: true,
}));

vi.mock('@/services/projectWorkspace', () => ({
  projectWorkspaceService: { getManagedEnvSummary },
}));

const { dispatchNonHeteroSubAgent } = await import('../nonHeteroSubAgentDispatcher');

describe('dispatchNonHeteroSubAgent workspace routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getManagedEnvSummary.mockResolvedValue({ hasManagedEnv: false });
  });

  it('keeps an unbound desktop child on its parent local intent via gateway coordination', async () => {
    const executeClientAgent = vi.fn();
    const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);

    await dispatchNonHeteroSubAgent(
      {
        instruction: 'inspect the current task',
        kind: 'mention',
        parentMessageId: 'tool-1',
        targetAgentId: 'child-agent',
      },
      {
        conversationContext: { agentId: 'parent-agent', topicId: 'topic-1' },
        isGatewayMode: false,
        parentRuntime: 'client',
      },
      { executeClientAgent, executeGatewayAgent } as any,
    );

    expect(executeGatewayAgent).toHaveBeenCalledWith({
      context: {
        agentId: 'child-agent',
        scope: 'sub_agent',
        subAgentId: 'child-agent',
        topicId: 'topic-1',
      },
      message: 'inspect the current task',
      parentOperationId: undefined,
    });
    expect(executeClientAgent).not.toHaveBeenCalled();
    expect(getManagedEnvSummary).not.toHaveBeenCalled();
  });

  it('routes an already-bound desktop child through gateway because tools can be injected', async () => {
    const executeClientAgent = vi.fn();
    const executeGatewayAgent = vi.fn().mockResolvedValue(undefined);

    await dispatchNonHeteroSubAgent(
      {
        instruction: 'inspect the workspace',
        kind: 'mention',
        parentMessageId: 'tool-1',
        targetAgentId: 'child-agent',
      },
      {
        conversationContext: { agentId: 'parent-agent', topicId: 'topic-1' },
        isGatewayMode: false,
        parentRuntime: 'client',
        workspaceId: 'workspace-1',
      },
      { executeClientAgent, executeGatewayAgent } as any,
    );

    expect(executeGatewayAgent).toHaveBeenCalledWith({
      context: {
        agentId: 'child-agent',
        scope: 'sub_agent',
        subAgentId: 'child-agent',
        topicId: 'topic-1',
      },
      message: 'inspect the workspace',
      parentOperationId: undefined,
    });
    expect(executeClientAgent).not.toHaveBeenCalled();
    expect(getManagedEnvSummary).not.toHaveBeenCalled();
  });
});
