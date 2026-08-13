import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGateway } from './DeviceGateway';

const mocks = vi.hoisted(() => ({
  connectGateway: vi.fn(),
  disconnectGateway: vi.fn(),
  gatewayState: {
    enabled: true,
    error: { code: 'NETWORK', message: 'socket closed', retriable: true },
    status: 'reconnecting',
  } as any,
  handlers: new Map<string, (payload: any) => void>(),
  setGatewayConnectionState: vi.fn(),
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: (event: string, handler: (payload: any) => void) => {
    mocks.handlers.set(event, handler);
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ loading, title }: { loading?: boolean; title?: string }) => (
    <span data-loading={String(Boolean(loading))}>{title}</span>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Input: Object.assign(
    (props: Record<string, unknown>) => <input aria-label="device-name" {...props} />,
    {
      TextArea: (props: Record<string, unknown>) => (
        <textarea aria-label="device-description" {...props} />
      ),
    },
  ),
  Popover: ({ children, content }: { children?: ReactNode; content?: ReactNode }) => (
    <div>
      {children}
      {content}
    </div>
  ),
  Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <button
      aria-checked={checked}
      role="switch"
      type="button"
      onClick={() => onChange?.(!checked)}
    />
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    fieldLabel: 'fieldLabel',
    greenDot: 'greenDot',
    input: 'input',
    popoverContent: 'popoverContent',
    statusError: 'statusError',
    statusText: 'statusText',
    statusTitle: 'statusTitle',
  }),
}));

vi.mock('lucide-react', () => ({ HardDrive: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      connectGateway: mocks.connectGateway,
      disconnectGateway: mocks.disconnectGateway,
      gatewayConnectionState: mocks.gatewayState,
      gatewayDeviceInfo: { description: '', name: 'Device' },
      refreshGatewayDeviceInfo: vi.fn(),
      setGatewayConnectionState: mocks.setGatewayConnectionState,
      updateDeviceDescription: vi.fn(),
      updateDeviceName: vi.fn(),
      useFetchGatewayDeviceInfo: vi.fn(),
      useFetchGatewayStatus: vi.fn(),
    }),
}));

describe('DeviceGateway', () => {
  beforeEach(() => {
    mocks.connectGateway.mockReset().mockResolvedValue(undefined);
    mocks.disconnectGateway.mockReset().mockResolvedValue(undefined);
    mocks.setGatewayConnectionState.mockReset();
    mocks.handlers.clear();
    mocks.gatewayState = {
      enabled: true,
      error: { code: 'NETWORK', message: 'socket closed', retriable: true },
      status: 'reconnecting',
    };
  });

  it('keeps the switch enabled while reconnecting and allows the user to disable it', () => {
    render(<DeviceGateway />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('gateway.errorNetwork')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));

    expect(mocks.disconnectGateway).toHaveBeenCalledTimes(1);
  });

  it('offers an immediate retry for recoverable failures', () => {
    render(<DeviceGateway />);

    fireEvent.click(screen.getByText('gateway.retryNow'));

    expect(mocks.connectGateway).toHaveBeenCalledTimes(1);
  });

  it('shows the online marker only after authentication succeeds', () => {
    mocks.gatewayState = { enabled: true, status: 'connected' };
    const { container } = render(<DeviceGateway />);

    expect(screen.getByText('gateway.statusConnected')).toBeInTheDocument();
    expect(container.querySelector('.greenDot')).not.toBeNull();
  });
});
