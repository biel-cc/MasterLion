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

  it('keeps an unbound desktop child in the parent client runtime', async () => {
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

    expect(executeClientAgent).toHaveBeenCalledWith({
      context: {
        agentId: 'parent-agent',
        scope: 'sub_agent',
        subAgentId: 'child-agent',
        topicId: 'topic-1',
      },
      inPortalThread: undefined,
      messages: [],
      parentMessageId: 'tool-1',
      parentMessageType: 'tool',
      parentOperationId: undefined,
    });
    expect(executeGatewayAgent).not.toHaveBeenCalled();
    expect(getManagedEnvSummary).not.toHaveBeenCalled();
  });

  it('keeps an already-bound desktop child in the renderer client runtime', async () => {
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

    expect(executeClientAgent).toHaveBeenCalledWith({
      context: {
        agentId: 'parent-agent',
        scope: 'sub_agent',
        subAgentId: 'child-agent',
        topicId: 'topic-1',
      },
      inPortalThread: undefined,
      messages: [],
      parentMessageId: 'tool-1',
      parentMessageType: 'tool',
      parentOperationId: undefined,
    });
    expect(executeGatewayAgent).not.toHaveBeenCalled();
    expect(getManagedEnvSummary).not.toHaveBeenCalled();
  });
});
