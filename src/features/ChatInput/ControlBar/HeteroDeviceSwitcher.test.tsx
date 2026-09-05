import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';

const mocks = vi.hoisted(() => ({
  agencyConfig: { executionTarget: 'none' } as any,
  devices: [] as any[],
  enableCloudSandbox: false,
  gatewayDeviceInfo: undefined as { deviceId: string; name?: string } | undefined,
  gatewayConnectionState: { enabled: true, status: 'disconnected' },
  isDesktop: true,
  updateAgentConfigById: vi.fn(async () => undefined),
}));

vi.mock('@lobechat/const', () => ({
  get isDesktop() {
    return mocks.isDesktop;
  },
}));
vi.mock('@lobechat/heterogeneous-agents', () => ({
  isRemoteHeterogeneousType: vi.fn(() => false),
}));
vi.mock('@icons-pack/react-simple-icons', () => ({
  SiApple: () => null,
  SiLinux: () => null,
}));
vi.mock('@lobehub/icons', () => ({ Microsoft: () => null }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  PopoverPopup: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  ),
  PopoverPortal: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverPositioner: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverRoot: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTriggerElement: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverViewport: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_target, property) => String(property) }),
  cssVar: new Proxy({}, { get: (_target, property) => String(property) }),
  cx: (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' '),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@/config/productFeatures', () => ({ isProductFeatureDisabled: vi.fn(() => false) }));
vi.mock('@/helpers/executionTarget', () => ({
  resolveExecutionTarget: (config?: { executionTarget?: string }) =>
    config?.executionTarget || 'none',
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    device: {
      listDevices: {
        useQuery: () => ({ data: mocks.devices, isLoading: false }),
      },
    },
  },
}));
vi.mock('@/services/electron/gatewayConnection', () => ({
  gatewayConnectionService: { getDeviceInfo: vi.fn() },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: any) => unknown) =>
    selector({ updateAgentConfigById: mocks.updateAgentConfigById }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => mocks.agencyConfig,
  },
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: any) => unknown) =>
    selector({
      gatewayDeviceInfo: mocks.gatewayDeviceInfo,
      gatewayConnectionState: mocks.gatewayConnectionState,
      useFetchGatewayDeviceInfo: vi.fn(),
    }),
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableCloudSandbox: (state: { enableCloudSandbox: boolean }) => state.enableCloudSandbox,
  },
  useServerConfigStore: (selector: (state: { enableCloudSandbox: boolean }) => unknown) =>
    selector({ enableCloudSandbox: mocks.enableCloudSandbox }),
}));

const clickSandboxOption = () => {
  const labels = screen.getAllByText('heteroAgent.executionTarget.sandbox');
  fireEvent.click(labels.at(-1)!);
};

describe('HeteroDeviceSwitcher', () => {
  beforeEach(() => {
    mocks.agencyConfig = { executionTarget: 'none' };
    mocks.devices = [];
    mocks.enableCloudSandbox = false;
    mocks.gatewayDeviceInfo = undefined;
    mocks.gatewayConnectionState = { enabled: true, status: 'disconnected' };
    mocks.isDesktop = true;
    mocks.updateAgentConfigById.mockClear();
  });

  it('represents this desktop only once as the local target', () => {
    const onSelectTarget = vi.fn();
    mocks.gatewayDeviceInfo = { deviceId: 'device-current' };
    mocks.gatewayConnectionState = { enabled: true, status: 'connected' };
    mocks.devices = [
      {
        deviceId: 'device-current',
        friendlyName: 'Current Mac',
        hostname: 'current.local',
        online: true,
        platform: 'darwin',
      },
      {
        deviceId: 'device-remote',
        friendlyName: 'Remote Mac',
        hostname: 'remote.local',
        online: true,
        platform: 'darwin',
      },
    ];

    render(
      <HeteroDeviceSwitcher
        agentId="agent-1"
        boundDeviceId="device-current"
        executionTarget="device"
        onSelectTarget={onSelectTarget}
      />,
    );

    expect(
      screen.getByRole('button', {
        name: /heteroAgent\.executionTarget\.title: heteroAgent\.executionTarget\.local/,
      }),
    ).toBeInTheDocument();
    const localOption = screen.getByRole('button', { name: /local Current Mac/ });
    expect(within(localOption).getByText('Current Mac')).toBeInTheDocument();
    expect(
      within(localOption).getByText('heteroAgent.executionTarget.localGatewayConnected'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Current Mac')).toHaveLength(1);
    expect(screen.getByText('Remote Mac')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('heteroAgent.executionTarget.local').at(-1)!);
    expect(onSelectTarget).not.toHaveBeenCalled();
  });

  it('updates gateway status without disabling local execution or adding the name to the chip', () => {
    const onSelectTarget = vi.fn();
    mocks.gatewayDeviceInfo = { deviceId: 'device-current', name: 'My desktop' };
    mocks.gatewayConnectionState = { enabled: true, status: 'connecting' };
    const view = render(
      <HeteroDeviceSwitcher
        agentId="agent-1"
        executionTarget="sandbox"
        onSelectTarget={onSelectTarget}
      />,
    );
    expect(
      screen.getByText('heteroAgent.executionTarget.localGatewayConnecting'),
    ).toBeInTheDocument();

    mocks.gatewayConnectionState = { enabled: false, status: 'disconnected' };
    view.rerender(
      <HeteroDeviceSwitcher
        agentId="agent-1"
        executionTarget="none"
        onSelectTarget={onSelectTarget}
      />,
    );
    const localOption = screen.getByRole('button', { name: /local My desktop/ });
    expect(localOption).toBeEnabled();
    expect(
      within(localOption).getByText('heteroAgent.executionTarget.localGatewayDisconnected'),
    ).toBeInTheDocument();
    fireEvent.click(localOption);
    expect(onSelectTarget).toHaveBeenCalledWith('local', 'device-current');
  });

  it('keeps web device rows without adding desktop-only connection details', () => {
    mocks.isDesktop = false;
    mocks.gatewayDeviceInfo = { deviceId: 'device-current', name: 'My desktop' };
    mocks.devices = [{ deviceId: 'device-current', friendlyName: 'My desktop', online: true }];
    render(
      <HeteroDeviceSwitcher
        agentId="agent-1"
        boundDeviceId="device-current"
        executionTarget="device"
        onSelectTarget={vi.fn()}
      />,
    );
    expect(screen.queryByText('heteroAgent.executionTarget.local')).not.toBeInTheDocument();
    expect(screen.queryByText(/localGateway/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'My desktop heteroAgent.executionTarget.online' }),
    ).toBeEnabled();
  });

  it('does not expose the internal no-device target in the desktop app', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" executionTarget="local" />);

    expect(screen.queryByText('heteroAgent.executionTarget.none')).not.toBeInTheDocument();
  });

  it('renders a locked target as display-only after the topic starts', () => {
    render(<HeteroDeviceSwitcher readOnly agentId="agent-1" executionTarget="local" />);

    expect(screen.getByTestId('execution-target-readonly')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /executionTarget\.title/ }),
    ).not.toBeInTheDocument();
  });

  it('disables the sandbox option when the server reports it as unavailable', () => {
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('Cloud sandbox is not configured on the server')).toBeInTheDocument();
    clickSandboxOption();

    expect(mocks.updateAgentConfigById).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /executionTarget\.title/ })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });

  it('allows selecting sandbox when the server reports it as configured', async () => {
    mocks.enableCloudSandbox = true;
    render(<HeteroDeviceSwitcher agentId="agent-1" />);

    expect(screen.getByText('heteroAgent.executionTarget.sandboxDesc')).toBeInTheDocument();
    clickSandboxOption();

    await waitFor(() =>
      expect(mocks.updateAgentConfigById).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          agencyConfig: expect.objectContaining({ executionTarget: 'sandbox' }),
        }),
      ),
    );
  });
});
