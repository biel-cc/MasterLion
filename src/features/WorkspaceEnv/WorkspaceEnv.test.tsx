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
  'workspaceEnv.invalidKey': 'Use uppercase letters, numbers, and underscores.',
  'workspaceEnv.keyLabel': 'Name',
  'workspaceEnv.loadError': 'Could not load variables.',
  'workspaceEnv.loading': 'Loading variables',
  'workspaceEnv.reservedKey': '{{key}} is set by the Masterino runtime.',
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
  'workspaceEnv.securitySensitiveKey': '{{key}} changes how commands load code.',
  'workspaceEnv.title': 'Workspace environment',
  'workspaceEnv.valueLabel': 'Value',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolate like i18next so restriction messages can be asserted with the offending key.
    t: (key: string, options?: Record<string, string>) =>
      Object.entries(options ?? {}).reduce(
        (message, [name, replacement]) => message.replaceAll(`{{${name}}}`, replacement),
        translations[key] ?? key,
      ),
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
  Empty: ({ description }: { description: ReactNode }) => <div>{description}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Skeleton: () => <div data-testid="skeleton" />,
}));

// Buttons must come from the headless base-ui package, so only that mock provides one.
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    htmlType,
    loading: _loading,
    ...props
  }: ComponentProps<'button'> & {
    htmlType?: 'button' | 'reset' | 'submit';
    loading?: boolean;
  }) => (
    <button {...props} type={htmlType ?? 'button'}>
      {children}
    </button>
  ),
  confirmModal: ({ onOk }: { onOk?: () => void | Promise<void> }) => void onOk?.(),
  Switch: ({
    checked,
    onChange,
    ...props
  }: {
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

    const loadingLabel = screen.getByText('Loading variables');
    expect(loadingLabel.closest('[role="status"]')).toBeInTheDocument();
    // A class the app actually defines; the old `sr-only` name has no stylesheet behind it.
    expect(loadingLabel).toHaveClass('screenReaderOnly');
    expect(loadingLabel).not.toHaveClass('sr-only');
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

  it('accepts uppercase names and rejects lowercase names before saving', async () => {
    render(<WorkspaceEnv client={createClient()} workspaceId="workspace-1" />);
    await screen.findByText('No variables yet');

    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'lowercase' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use uppercase letters, numbers, and underscores.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(input, { target: { value: 'UPPER_KEY' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it.each([
    ['HOME', '{{key}} is set by the Masterino runtime.'],
    ['PATH', '{{key}} is set by the Masterino runtime.'],
    ['DYLD_INSERT_LIBRARIES', '{{key}} is set by the Masterino runtime.'],
    ['LOBEHUB_JWT', '{{key}} is set by the Masterino runtime.'],
    ['MASTERINO_WORKSPACE', '{{key}} is set by the Masterino runtime.'],
    ['NODE_OPTIONS', '{{key}} changes how commands load code.'],
    ['LD_PRELOAD', '{{key}} changes how commands load code.'],
  ])('explains that %s is rejected before the server sees it', async (name, template) => {
    const save = vi.fn(async () => {});
    render(<WorkspaceEnv client={createClient({ save })} workspaceId="workspace-1" />);
    await screen.findByText('No variables yet');

    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'anything' } });

    const alert = screen.getByRole('alert');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(alert).toHaveTextContent(template.replace('{{key}}', name));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(saveButton).toBeDisabled();

    // Submitting around the disabled button must stay a no-op, not a failed round-trip.
    fireEvent.submit(saveButton.closest('form')!);
    expect(save).not.toHaveBeenCalled();
  });

  it('clears the reserved-key warning once the name becomes configurable', async () => {
    render(<WorkspaceEnv client={createClient()} workspaceId="workspace-1" />);
    await screen.findByText('No variables yet');

    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'HOME' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'anything' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(input, { target: { value: 'HOME_DIR' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
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
