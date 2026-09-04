/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import type { BindWorkspaceOnce } from './useBindWorkspaceOnce';
import WorkspacePicker from './WorkspacePicker';

const storeState = {
  currentDeviceId: 'device-1',
  pickerFocusNonce: 0,
  recents: [] as Array<{ path: string; repoType?: 'git' | 'github' }>,
  seamAvailable: true,
  workspaces: [] as Array<{ displayName?: string; repoType?: 'git' | 'github'; rootPath: string }>,
};

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    children,
    'data-testid': testId,
  }: {
    'children'?: ReactNode;
    'data-testid'?: string;
  }) => <div data-testid={testId}>{children}</div>,
  Icon: () => null,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: ReactElement; title?: string }) => children,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/device', () => ({ deviceService: { statPath: vi.fn() } }));
vi.mock('@/services/electron/system', () => ({
  electronSystemService: { selectFolder: vi.fn() },
}));
vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceWorkingDirs: () => (state: typeof storeState) => state.recents,
  },
  useDeviceStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: { gatewayDeviceInfo: { deviceId: string } }) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: storeState.currentDeviceId } }),
}));
vi.mock('@/store/projectWorkspace', () => ({
  projectWorkspaceSelectors: {
    getDeviceWorkspaces: () => (state: typeof storeState) => state.workspaces,
    isSeamAvailable: (state: typeof storeState) => state.seamAvailable,
    pickerFocusNonce: (state: typeof storeState) => state.pickerFocusNonce,
  },
  useProjectWorkspaceStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));
vi.mock('./AddWorkingDirModal', () => ({ openAddWorkingDirModal: vi.fn() }));
vi.mock('./DirIcon', () => ({ default: () => null }));

const effective = {
  context: {},
  draftKey: 'agent-1',
  isDraft: true,
  recommendation: { agentDefault: '/projects/app', deviceId: 'device-1' },
  state: 'unbound',
  target: 'local',
  targetDeviceId: 'device-1',
} as EffectiveWorkspace;

describe('WorkspacePicker', () => {
  beforeEach(() => {
    storeState.currentDeviceId = 'device-1';
    storeState.pickerFocusNonce = 0;
    storeState.recents = [];
    storeState.seamAvailable = true;
    storeState.workspaces = [];
  });

  it('renders the controlled base-ui popover and closes after a successful selection', async () => {
    const onOpenChange = vi.fn();
    const select = vi.fn().mockResolvedValue(true);
    const clearError = vi.fn();
    const bind = {
      canSelect: true,
      canStartReferencedTopic: false,
      clearError,
      deviceId: 'device-1',
      pending: false,
      select,
      startReferencedTopic: vi.fn(),
    } as unknown as BindWorkspaceOnce;

    render(
      <WorkspacePicker
        open
        bind={bind}
        effective={effective}
        trigger={<span data-testid="picker-anchor" />}
        onOpenChange={onOpenChange}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'workspaceRuntime.picker.title' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('picker-anchor')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('picker-anchor')).toHaveAttribute('tabindex', '-1');

    fireEvent.click(screen.getByRole('button', { name: /app/i }));

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith(expect.objectContaining({ path: '/projects/app' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(clearError).toHaveBeenCalledOnce();
    });
  });

  it('shows an honest loading state instead of flashing an empty list', () => {
    const bind = {
      clearError: vi.fn(),
      deviceId: 'device-1',
      pending: false,
      select: vi.fn(),
      startReferencedTopic: vi.fn(),
    } as unknown as BindWorkspaceOnce;

    render(<WorkspacePicker open bind={bind} effective={{ ...effective, loading: true }} />);

    expect(screen.getByRole('status')).toHaveTextContent('workspaceRuntime.picker.loading');
    expect(screen.queryByText('workspaceRuntime.picker.empty')).not.toBeInTheDocument();
  });

  it('keeps local workspace selection available while evidence reload fails', () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const bind = {
      clearError: vi.fn(),
      deviceId: 'device-1',
      pending: false,
      select: vi.fn(),
      startReferencedTopic: vi.fn(),
    } as unknown as BindWorkspaceOnce;

    render(
      <WorkspacePicker
        open
        bind={bind}
        effective={{ ...effective, loadError: new Error('offline'), reload }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.picker.retry' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /app/i })).toBeInTheDocument();
    expect(screen.getByTestId('workspace-picker-choose-folder')).toBeInTheDocument();
  });

  it('does not claim a recommendation will bind a workspace on an old server', () => {
    storeState.seamAvailable = false;
    const bind = {
      clearError: vi.fn(),
      deviceId: 'device-1',
      pending: false,
      select: vi.fn(),
      startReferencedTopic: vi.fn(),
    } as unknown as BindWorkspaceOnce;

    render(<WorkspacePicker open bind={bind} effective={effective} />);

    expect(screen.getByText('workspaceRuntime.picker.seamUnavailable')).toBeInTheDocument();
    expect(screen.queryByText('workspaceRuntime.picker.recommendedNote')).not.toBeInTheDocument();
  });
});
