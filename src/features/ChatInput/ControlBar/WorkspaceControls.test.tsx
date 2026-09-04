/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveWorkspace } from '@/hooks/useEffectiveWorkspace';

import WorkspaceControls from './WorkspaceControls';

const mocks = vi.hoisted(() => ({
  effective: {} as EffectiveWorkspace,
  seamAvailable: false,
}));

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useEffectiveWorkspace', () => ({
  useEffectiveWorkspace: () => mocks.effective,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentHeterogeneousById: () => () => false },
}));
vi.mock('@/store/device', () => ({
  deviceSelectors: { getDeviceWorkingDirs: () => () => [] },
  useDeviceStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/electron', () => ({
  useElectronStore: (selector: (state: object) => unknown) =>
    selector({ gatewayDeviceInfo: { deviceId: 'device-1' } }),
}));
vi.mock('@/store/projectWorkspace', () => ({
  useProjectWorkspaceStore: (selector: (state: object) => unknown) =>
    selector({
      captureTopicTarget: vi.fn(),
      seamAvailable: mocks.seamAvailable,
      setDraftTargetIntent: vi.fn(),
    }),
}));
vi.mock('./CloudRepoSwitcher', () => ({ default: () => <div data-testid="cloud-repo" /> }));
vi.mock('./GitStatus', () => ({ default: () => <div data-testid="git-status" /> }));
vi.mock('./HeteroDeviceSwitcher', () => ({
  default: () => <div data-testid="device-switcher" />,
}));
vi.mock('./WorkspaceChip', () => ({ default: () => <div data-testid="workspace-chip" /> }));
vi.mock('./WorkspacePicker', () => ({ default: () => <div data-testid="workspace-picker" /> }));
vi.mock('./useBindWorkspaceOnce', () => ({ useBindWorkspaceOnce: () => ({}) }));
vi.mock('./useRepoType', () => ({ useRepoType: () => undefined }));

describe('WorkspaceControls old-server compatibility', () => {
  beforeEach(() => {
    mocks.seamAvailable = false;
    mocks.effective = {
      context: {
        cwd: '/projects/legacy',
        plan: { deviceId: 'device-1', kind: 'device', target: 'local' },
        version: 1,
        workspace: {
          deviceId: 'device-1',
          kind: 'device',
          rootPath: '/projects/legacy',
        },
      },
      cwd: '/projects/legacy',
      draftKey: 'draft::agent-1',
      isDraft: true,
      recommendation: { deviceId: 'device-1' },
      state: 'bound',
      target: 'local',
      targetDeviceId: 'device-1',
      workspace: { deviceId: 'device-1', kind: 'device', rootPath: '/projects/legacy' },
    };
  });

  it('keeps legacy cwd selection editable instead of claiming a formal locked binding', () => {
    render(<WorkspaceControls agentId="agent-1" />);

    expect(screen.getByTestId('workspace-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-chip')).not.toBeInTheDocument();
  });
});
