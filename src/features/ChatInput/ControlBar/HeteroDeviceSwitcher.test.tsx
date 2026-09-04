import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HeteroDeviceSwitcher from './HeteroDeviceSwitcher';

const mocks = vi.hoisted(() => ({
  agencyConfig: { executionTarget: 'none' } as any,
  devices: [] as any[],
  enableCloudSandbox: false,
  gatewayDeviceInfo: undefined as { deviceId: string } | undefined,
  updateAgentConfigById: vi.fn(async () => undefined),
}));

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
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
    <div role="dialog" {...props}>{children}</div>
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
    mocks.updateAgentConfigById.mockClear();
  });

  it('represents this desktop only once as the local target', () => {
    const onSelectTarget = vi.fn();
    mocks.gatewayDeviceInfo = { deviceId: 'device-current' };
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
    expect(screen.queryByText('Current Mac')).not.toBeInTheDocument();
    expect(screen.getByText('Remote Mac')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('heteroAgent.executionTarget.local').at(-1)!);
    expect(onSelectTarget).not.toHaveBeenCalled();
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
