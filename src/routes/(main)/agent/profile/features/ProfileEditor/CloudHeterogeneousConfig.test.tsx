import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CloudHeterogeneousConfig from './CloudHeterogeneousConfig';

const { createKV, credsList } = vi.hoisted(() => ({
  createKV: vi.fn(),
  credsList: vi.fn(() => ({ data: { data: [] }, isLoading: false, refetch: vi.fn() })),
}));

vi.mock('@lobechat/types', () => ({}));
vi.mock('@lobehub/icons', () => ({ Github: () => null }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('antd', () => ({
  Avatar: () => null,
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props} type="button">
      {children}
    </button>
  ),
  Input: Object.assign(
    (props: ComponentProps<'input'>) => <input {...props} />,
    {
      Password: ({
        onPressEnter: _onPressEnter,
        ...props
      }: ComponentProps<'input'> & { onPressEnter?: () => void }) => <input {...props} />,
    },
  ),
  Select: Object.assign(() => null, { Option: () => null }),
  Spin: () => null,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Typography: { Text: ({ children }: { children?: ReactNode }) => <span>{children}</span> },
}));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, property) => String(property) }),
  cssVar: new Proxy({}, { get: (_, property) => `var(--${String(property)})` }),
}));
vi.mock('lucide-react', () => ({
  CheckCircle2: () => null,
  KeyRound: () => null,
  X: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'heterogeneousStatus.cloud.agentEnv.saveError': 'Could not save the agent environment.',
        'heterogeneousStatus.cloud.repoAdd': 'Add repo',
        'heterogeneousStatus.cloud.tokenSave': 'Save token',
        'heterogeneousStatus.cloud.tokenSaveError': 'Could not save the Claude Code token.',
      })[key] ?? key,
  }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { market: { creds: { createKV: { mutate: createKV } } } },
  lambdaQuery: { market: { creds: { list: { useQuery: credsList } } } },
}));
vi.mock('@/features/AgentEnvironment', () => ({ AgentEnvironmentEditor: () => null }));

describe('CloudHeterogeneousConfig', () => {
  beforeEach(() => {
    createKV.mockReset();
    createKV.mockResolvedValue(undefined);
  });

  it('reports a rejected env write instead of dropping it on the floor', async () => {
    const onEnvChange = vi.fn().mockRejectedValue(new Error('offline'));
    render(<CloudHeterogeneousConfig env={{ GITHUB_REPOS: '[]' }} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByPlaceholderText('heterogeneousStatus.cloud.repoPlaceholder'), {
      target: { value: 'owner/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add repo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the agent environment.',
    );
  });

  it('keeps quiet when the env write succeeds', async () => {
    const onEnvChange = vi.fn().mockResolvedValue(undefined);
    render(<CloudHeterogeneousConfig env={{ GITHUB_REPOS: '[]' }} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByPlaceholderText('heterogeneousStatus.cloud.repoPlaceholder'), {
      target: { value: 'owner/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add repo' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({ GITHUB_REPOS: '["owner/repo"]' });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a failed credential write rather than leaving an unhandled rejection', async () => {
    createKV.mockRejectedValue(new Error('vault down'));
    const onEnvChange = vi.fn().mockResolvedValue(undefined);
    render(<CloudHeterogeneousConfig env={{}} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByPlaceholderText('heterogeneousStatus.cloud.tokenPlaceholder'), {
      target: { value: 'sk-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the Claude Code token.',
    );
    // The draft survives the failure so the token does not have to be pasted again.
    expect(screen.getByPlaceholderText('heterogeneousStatus.cloud.tokenPlaceholder')).toHaveValue(
      'sk-token',
    );
    expect(onEnvChange).not.toHaveBeenCalled();
  });
});
