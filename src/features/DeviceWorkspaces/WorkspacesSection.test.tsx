import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspacesSection from './WorkspacesSection';

interface FakeWorkspace {
  id: string;
  rootPath: string;
}

const { fetchResult, mutate, state } = vi.hoisted(() => ({
  fetchResult: {
    error: undefined as unknown,
    isLoading: false,
  },
  mutate: vi.fn(),
  state: {
    isWorkspacesInit: true,
    seamAvailable: true,
    workspaces: [] as FakeWorkspace[],
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props} type="button">
      {children}
    </button>
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./WorkspaceRow', () => ({
  default: ({ workspace }: { workspace: FakeWorkspace }) => <div>row {workspace.id}</div>,
}));
vi.mock('@/store/projectWorkspace', () => ({
  projectWorkspaceSelectors: {
    getDeviceWorkspaces: () => () => state.workspaces,
    isSeamAvailable: () => state.seamAvailable,
  },
  useProjectWorkspaceStore: (
    selector: (store: {
      isWorkspacesInit: boolean;
      useFetchWorkspaces: () => typeof fetchResult & { mutate: typeof mutate };
    }) => unknown,
  ) =>
    selector({
      isWorkspacesInit: state.isWorkspacesInit,
      useFetchWorkspaces: () => ({ ...fetchResult, mutate }),
    }),
}));

describe('WorkspacesSection', () => {
  beforeEach(() => {
    mutate.mockReset();
    fetchResult.error = undefined;
    fetchResult.isLoading = false;
    state.isWorkspacesInit = true;
    state.seamAvailable = true;
    state.workspaces = [];
  });

  it('offers a retry for a transient fetch failure instead of calling the feature unavailable', () => {
    fetchResult.error = new Error('network down');

    render(<WorkspacesSection deviceId="device-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'workspaceRuntime.settings.workspacesError',
    );
    expect(
      screen.queryByText('workspaceRuntime.settings.workspacesUnavailable'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workspaceRuntime.settings.workspacesRetry' }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('calls the feature unavailable only when the seam is genuinely missing', () => {
    state.seamAvailable = false;

    render(<WorkspacesSection deviceId="device-1" />);

    expect(screen.getByText('workspaceRuntime.settings.workspacesUnavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.queryByText('workspaceRuntime.settings.workspacesError'),
    ).not.toBeInTheDocument();
  });

  it('shows the empty state once the fetch settles with no formal workspace', () => {
    render(<WorkspacesSection deviceId="device-1" />);

    expect(screen.getByText('workspaceRuntime.settings.workspacesEmpty')).toBeInTheDocument();
  });

  it('lists the device workspaces it fetched', () => {
    state.workspaces = [{ id: 'workspace-1', rootPath: '/repo' }];

    render(<WorkspacesSection deviceId="device-1" />);

    expect(screen.getByText('row workspace-1')).toBeInTheDocument();
  });

  it('keeps showing the loading copy while the first fetch is in flight', () => {
    fetchResult.isLoading = true;
    state.isWorkspacesInit = false;

    render(<WorkspacesSection deviceId="device-1" />);

    expect(screen.getByText('workspaceRuntime.settings.workspacesLoading')).toBeInTheDocument();
  });
});
