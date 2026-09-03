/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousChatInput from './index';

const mocks = vi.hoisted(() => ({
  chatInputProps: [] as Array<Record<string, any>>,
  deviceGuardOptions: [] as Array<Record<string, unknown>>,
  effective: {
    context: { plan: { kind: 'local', target: 'local' } },
    state: 'bound',
    target: 'local',
    targetDeviceId: undefined,
    unroutedReason: undefined,
  } as Record<string, any>,
  focusWorkspacePicker: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents', () => ({
  HETEROGENEOUS_TYPE_LABELS: {},
  isRemoteHeterogeneousType: () => false,
}));
vi.mock('@lobehub/ui', () => ({
  Alert: ({
    action,
    description,
    title,
    ...props
  }: {
    action?: ReactNode;
    description?: ReactNode;
    title?: ReactNode;
    [key: string]: unknown;
  }) => (
    <div data-testid={props['data-testid'] as string | undefined} role="alert">
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  ),
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ aid: 'agent-1' }),
}));
vi.mock('url-join', () => ({ default: (...parts: string[]) => parts.join('/') }));
vi.mock('@/business/client/hooks/useHeteroAgentCloudConfig', () => ({
  useHeteroAgentCloudConfig: () => ({ goToConfig: vi.fn(), isConfigured: true }),
}));
vi.mock('@/const/version', () => ({ isDesktop: true }));
vi.mock('@/features/ChatInput', () => ({}));
vi.mock('@/features/Conversation', () => ({
  ChatInput: (props: Record<string, any>) => {
    mocks.chatInputProps.push(props);
    return (
      <button
        data-testid="send"
        disabled={props.sendButtonProps?.disabled}
        type="button"
        onClick={() => props.sendButtonProps?.onDisabledSend?.()}
      >
        send
      </button>
    );
  },
}));
vi.mock('@/features/Conversation/store', () => ({
  contextSelectors: { agentId: () => 'agent-1' },
  useConversationStore: (selector: (s: any) => unknown) => selector({}),
}));
vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/helpers/executionTarget', () => ({ resolveExecutionTarget: () => 'local' }));
vi.mock('@/hooks/useEffectiveWorkspace', () => ({
  useEffectiveWorkspace: () => mocks.effective,
}));
vi.mock('@/hooks/useRemoteAgentDeviceGuard', () => ({
  useRemoteAgentDeviceGuard: (options: Record<string, unknown>) => {
    mocks.deviceGuardOptions.push(options);
    return { refresh: vi.fn(), status: 'ok' };
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: any) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentConfigById: () => () => ({
      agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
    }),
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: { setState: vi.fn() },
}));
vi.mock('@/store/projectWorkspace', () => ({
  useProjectWorkspaceStore: (selector: (s: any) => unknown) =>
    selector({ focusWorkspacePicker: mocks.focusWorkspacePicker }),
}));
vi.mock('./HeteroControlBar', () => ({ default: () => null }));

describe('HeterogeneousChatInput workspace gate', () => {
  beforeEach(() => {
    mocks.chatInputProps.length = 0;
    mocks.deviceGuardOptions.length = 0;
    mocks.focusWorkspacePicker.mockClear();
    mocks.effective = {
      context: { plan: { kind: 'local', target: 'local' } },
      state: 'bound',
      target: 'local',
      targetDeviceId: undefined,
    };
  });

  it('disables send and focuses the workspace picker while unbound', () => {
    mocks.effective = {
      context: { plan: { kind: 'local', target: 'local' } },
      state: 'unbound',
      target: 'local',
    };
    render(<HeterogeneousChatInput />);

    const guard = screen.getByTestId('hetero-workspace-guard');
    expect(guard).toHaveTextContent('workspaceRuntime.hetero.gate.title');
    expect(screen.getByTestId('send')).toBeDisabled();
    expect(mocks.chatInputProps.at(-1)?.disableSend).toBe(true);

    fireEvent.click(screen.getByText('workspaceRuntime.hetero.gate.action'));
    expect(mocks.focusWorkspacePicker).toHaveBeenCalledTimes(1);

    mocks.chatInputProps.at(-1)?.sendButtonProps.onDisabledSend();
    expect(mocks.focusWorkspacePicker).toHaveBeenCalledTimes(2);
  });

  it('disables send with the unrouted reason', () => {
    mocks.effective = {
      context: { plan: { kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' } },
      state: 'unrouted',
      target: 'device',
      targetDeviceId: 'device-topic',
      unroutedReason: 'bound-device-offline',
    };
    render(<HeterogeneousChatInput />);

    expect(screen.getByTestId('hetero-workspace-guard')).toHaveTextContent(
      'workspaceRuntime.hetero.gate.unrouted.bound-device-offline',
    );
    expect(screen.getByTestId('send')).toBeDisabled();
    expect(mocks.chatInputProps.at(-1)?.disableSend).toBe(true);
    expect(mocks.deviceGuardOptions.at(-1)).toEqual({
      agentId: 'agent-1',
      deviceId: 'device-topic',
      enabled: true,
    });
  });

  it('blocks scratch and opens the new referenced-topic picker', () => {
    mocks.effective = {
      context: { plan: { deviceId: 'device-topic', kind: 'device', target: 'device' } },
      state: 'scratch',
      target: 'device',
      targetDeviceId: 'device-topic',
    };
    render(<HeterogeneousChatInput />);

    expect(screen.getByTestId('hetero-workspace-guard')).toHaveTextContent(
      'workspaceRuntime.hetero.gate.scratchTitle',
    );
    expect(screen.getByTestId('send')).toBeDisabled();
    fireEvent.click(screen.getByText('workspaceRuntime.hetero.gate.action'));
    expect(mocks.focusWorkspacePicker).toHaveBeenCalledTimes(1);
  });

  it('allows send when bound', () => {
    mocks.effective = {
      context: { plan: { kind: 'local', target: 'local' } },
      state: 'bound',
      target: 'local',
    };
    render(<HeterogeneousChatInput />);

    expect(screen.queryByTestId('hetero-workspace-guard')).not.toBeInTheDocument();
    expect(screen.getByTestId('send')).not.toBeDisabled();
    expect(mocks.chatInputProps.at(-1)?.disableSend).toBe(false);
    expect(mocks.chatInputProps.at(-1)?.sendButtonProps.onDisabledSend).toBeUndefined();
  });

  it('guards the topic-scoped device even when the agent default resolves elsewhere', () => {
    mocks.effective = {
      context: { plan: { deviceId: 'device-topic', kind: 'device', target: 'device' } },
      state: 'bound',
      target: 'device',
      targetDeviceId: 'device-topic',
    };

    render(<HeterogeneousChatInput />);

    expect(mocks.deviceGuardOptions.at(-1)).toEqual({
      agentId: 'agent-1',
      deviceId: 'device-topic',
      enabled: true,
    });
  });
});
