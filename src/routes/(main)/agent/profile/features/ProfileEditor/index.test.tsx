import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfileEditor from './index';

const { state, updateAgentConfig } = vi.hoisted(() => ({
  state: {
    config: {
      agencyConfig: {
        boundDeviceId: 'device-1',
        env: { GITHUB_CRED_KEY: 'credential-ref', SOURCE: 'agency' },
        heterogeneousProvider: { env: { SOURCE: 'legacy' }, type: 'claude-code' },
      },
    },
  } as { config: Record<string, any> },
  updateAgentConfig: vi.fn(),
}));

vi.mock('@lobechat/const', () => ({ isDesktop: true }));
vi.mock('@lobechat/heterogeneous-agents', () => ({
  isRemoteHeterogeneousType: () => false,
}));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('antd', () => ({
  Divider: () => <hr />,
  Tabs: ({ items }: { items: Array<{ children: ReactNode; key: string }> }) => (
    <div>{items.find(({ key }) => key === 'cloud')?.children}</div>
  ),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (store: Record<string, unknown>) => unknown) =>
    selector({ config: state.config, heterogeneous: true, updateAgentConfig }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (store: { config: unknown }) => store.config,
    isCurrentAgentHeterogeneous: (store: { heterogeneous: boolean }) => store.heterogeneous,
  },
}));
vi.mock('@/features/ModelSelect', () => ({ default: () => null }));
vi.mock('../AgentSettings', () => ({ default: () => null }));
vi.mock('../EditorCanvas', () => ({ default: () => null }));
vi.mock('./AgentHeader', () => ({ default: () => null }));
vi.mock('./AgentTool', () => ({ default: () => null }));
vi.mock('./HeterogeneousAgentStatusCard', () => ({ default: () => null }));
vi.mock('./RemoteAgentConfigCard', () => ({ default: () => null }));
vi.mock('./CloudHeterogeneousConfig', () => ({
  default: ({
    env,
    onEnvChange,
  }: {
    env: Record<string, string>;
    onEnvChange: (env: Record<string, string>) => void;
  }) => (
    <div>
      <output aria-label="agent environment">{JSON.stringify(env)}</output>
      <button
        type="button"
        onClick={() =>
          onEnvChange({
            ...env,
            HOME: '/unsafe',
            LOBEHUB_JWT: 'unsafe',
            LOBEHUB_SERVER: 'unsafe',
            NEXT: 'value',
            PATH: '/unsafe',
            SERVICE_API_KEY: 'unsafe',
            lowercase: 'invalid',
          })
        }
      >
        update environment
      </button>
    </div>
  ),
}));

describe('ProfileEditor agent environment', () => {
  beforeEach(() => {
    updateAgentConfig.mockReset();
    state.config = {
      agencyConfig: {
        boundDeviceId: 'device-1',
        env: { GITHUB_CRED_KEY: 'credential-ref', SOURCE: 'agency' },
        heterogeneousProvider: { env: { SOURCE: 'legacy' }, type: 'claude-code' },
      },
    };
  });

  it('reads agencyConfig.env first and writes only the new agent env field', async () => {
    render(<ProfileEditor />);

    expect(screen.getByLabelText('agent environment')).toHaveTextContent(
      '{"GITHUB_CRED_KEY":"credential-ref","SOURCE":"agency"}',
    );
    fireEvent.click(screen.getByRole('button', { name: 'update environment' }));

    await waitFor(() => {
      expect(updateAgentConfig).toHaveBeenCalledWith({
        agencyConfig: {
          env: { GITHUB_CRED_KEY: 'credential-ref', NEXT: 'value', SOURCE: 'agency' },
        },
      });
    });
    expect(updateAgentConfig.mock.calls[0][0].agencyConfig).not.toHaveProperty(
      'heterogeneousProvider',
    );
  });

  it('falls back to heterogeneousProvider.env for legacy agents', () => {
    state.config = {
      agencyConfig: {
        heterogeneousProvider: { env: { SOURCE: 'legacy' }, type: 'claude-code' },
      },
    };

    render(<ProfileEditor />);

    expect(screen.getByLabelText('agent environment')).toHaveTextContent('{"SOURCE":"legacy"}');
  });

  it('treats an explicitly empty agent env as authoritative over the legacy value', () => {
    state.config = {
      agencyConfig: {
        env: {},
        heterogeneousProvider: { env: { SOURCE: 'legacy' }, type: 'claude-code' },
      },
    };

    render(<ProfileEditor />);

    expect(screen.getByLabelText('agent environment')).toHaveTextContent('{}');
  });
});
