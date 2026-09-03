import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceEnvClient } from './types';
import WorkspaceEnv from './WorkspaceEnv';

const translations: Record<string, string> = {
  'workspaceEnv.configured': 'Configured',
  'workspaceEnv.configuredList': 'Configured variables',
  'workspaceEnv.description': 'Variables are added to agent commands in this workspace.',
  'workspaceEnv.empty': 'No variables yet',
  'workspaceEnv.formLabel': 'Add or replace a variable',
  'workspaceEnv.invalidKey': 'Use letters, numbers, and underscores.',
  'workspaceEnv.keyLabel': 'Name',
  'workspaceEnv.loadError': 'Could not load variables.',
  'workspaceEnv.loading': 'Loading variables',
  'workspaceEnv.retry': 'Retry',
  'workspaceEnv.revoke': 'Revoke',
  'workspaceEnv.revokeConfirmDescription': 'Commands will stop receiving this variable.',
  'workspaceEnv.revokeConfirmTitle': 'Revoke variable?',
  'workspaceEnv.revokeSuccess': 'Variable revoked.',
  'workspaceEnv.save': 'Save',
  'workspaceEnv.saveError': 'Could not save the change.',
  'workspaceEnv.saveSuccess': 'Variable saved.',
  'workspaceEnv.secret': 'Secret',
  'workspaceEnv.secretLabel': 'Store as a secret',
  'workspaceEnv.title': 'Workspace environment',
  'workspaceEnv.valueLabel': 'Value',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () =>
    new Proxy(
      {},
      {
        get: (_, property) => String(property),
      },
    ),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, htmlType, loading: _loading, ...props }: ComponentProps<'button'> & {
    htmlType?: 'button' | 'reset' | 'submit';
    loading?: boolean;
  }) => (
    <button {...props} type={htmlType ?? 'button'}>
      {children}
    </button>
  ),
  Empty: ({ description }: { description: ReactNode }) => <div>{description}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: ({ onOk }: { onOk?: () => void | Promise<void> }) => void onOk?.(),
  Switch: ({ checked, onChange, ...props }: {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
  } & Omit<ComponentProps<'input'>, 'onChange'>) => (
    <input
      {...props}
      checked={checked}
      type="checkbox"
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
}));

const createClient = (overrides: Partial<WorkspaceEnvClient> = {}): WorkspaceEnvClient => ({
  list: vi.fn(async () => []),
  revoke: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
  ...overrides,
});

describe('WorkspaceEnv', () => {
  it('shows a labelled loading state', () => {
    const client = createClient({
      list: vi.fn(() => new Promise<never>(() => {})),
    });
    render(<WorkspaceEnv client={client} workspaceId="workspace-1" />);

    expect(screen.getByText('Loading variables').closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('shows the empty state after loading', async () => {
    render(<WorkspaceEnv client={createClient()} workspaceId="workspace-1" />);

    expect(await screen.findByText('No variables yet')).toBeInTheDocument();
  });

  it('shows a generic load error and retries', async () => {
    const list = vi
      .fn<WorkspaceEnvClient['list']>()
      .mockRejectedValueOnce(new Error('private server detail'))
      .mockResolvedValueOnce([]);
    render(<WorkspaceEnv client={createClient({ list })} workspaceId="workspace-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load variables.');
    expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No variables yet')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('renders secret entries masked and never receives a plaintext value', async () => {
    const list = vi.fn(async () => [{ key: 'API_TOKEN', secret: true }]);
    render(<WorkspaceEnv client={createClient({ list })} workspaceId="workspace-1" />);

    expect(await screen.findByText('••••••••')).toBeInTheDocument();
    expect(list.mock.results[0].value).resolves.toEqual([{ key: 'API_TOKEN', secret: true }]);
    expect(screen.queryByText(/server-secret/i)).not.toBeInTheDocument();
  });

  it('saves a secret with accessible labels and clears the plaintext field', async () => {
    const save = vi.fn(async () => {});
    render(<WorkspaceEnv client={createClient({ save })} workspaceId="workspace-1" />);
    await screen.findByText('No variables yet');

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'API_TOKEN' },
    });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('workspace-1', {
        key: 'API_TOKEN',
        secret: true,
        value: 'new-secret',
      }),
    );
    expect(await screen.findByText('Variable saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveValue('');
    expect(screen.getByText('••••••••')).toBeInTheDocument();
  });

  it('validates names before saving', async () => {
    render(<WorkspaceEnv client={createClient()} workspaceId="workspace-1" />);
    await screen.findByText('No variables yet');

    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'BAD-KEY' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Use letters, numbers, and underscores.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('revokes an entry and announces completion', async () => {
    const revoke = vi.fn(async () => {});
    render(
      <WorkspaceEnv
        workspaceId="workspace-1"
        client={createClient({
          list: vi.fn(async () => [{ key: 'API_TOKEN', secret: true }]),
          revoke,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'workspaceEnv.revokeLabel' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('workspace-1', 'API_TOKEN'));
    expect(await screen.findByText('Variable revoked.')).toBeInTheDocument();
    expect(screen.queryByText('API_TOKEN')).not.toBeInTheDocument();
  });
});
