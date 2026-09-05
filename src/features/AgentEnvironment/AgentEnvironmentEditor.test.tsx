import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEnvironmentEditor } from './AgentEnvironmentEditor';
import { sanitizeAgentEnv } from './agentEnvPolicy';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    htmlType,
    loading: _loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    htmlType?: 'button' | 'reset' | 'submit';
    loading?: boolean;
  }) => <button {...props} type={htmlType ?? 'button'} />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { key?: string }) =>
      ({
        'heterogeneousStatus.cloud.agentEnv.add': 'Add',
        'heterogeneousStatus.cloud.agentEnv.description': 'Never store secrets here',
        'heterogeneousStatus.cloud.agentEnv.empty': 'No custom values',
        'heterogeneousStatus.cloud.agentEnv.formLabel': 'Edit agent environment',
        'heterogeneousStatus.cloud.agentEnv.invalidKey': 'Use uppercase names',
        'heterogeneousStatus.cloud.agentEnv.keyLabel': 'Name',
        'heterogeneousStatus.cloud.agentEnv.keyPlaceholder': 'MODE',
        'heterogeneousStatus.cloud.agentEnv.listLabel': 'Agent environment values',
        'heterogeneousStatus.cloud.agentEnv.managedKey': `${options?.key} is managed`,
        'heterogeneousStatus.cloud.agentEnv.remove': 'Remove',
        'heterogeneousStatus.cloud.agentEnv.removeLabel': `Remove ${options?.key}`,
        'heterogeneousStatus.cloud.agentEnv.removeSuccess': `${options?.key} removed`,
        'heterogeneousStatus.cloud.agentEnv.reservedKey': `${options?.key} is reserved`,
        'heterogeneousStatus.cloud.agentEnv.saveError': 'Could not save',
        'heterogeneousStatus.cloud.agentEnv.saveSuccess': `${options?.key} saved`,
        'heterogeneousStatus.cloud.agentEnv.sensitiveKey': `${options?.key} looks sensitive`,
        'heterogeneousStatus.cloud.agentEnv.title': 'Agent environment',
        'heterogeneousStatus.cloud.agentEnv.update': 'Update',
        'heterogeneousStatus.cloud.agentEnv.valueLabel': 'Value',
        'heterogeneousStatus.cloud.agentEnv.valuePlaceholder': 'development',
      })[key] ?? key,
  }),
}));

const env = {
  CLAUDE_CODE_CRED_KEY: 'claude-credential-ref',
  GITHUB_CRED_KEY: 'github-credential-ref',
  GITHUB_REPOS: '["owner/repo"]',
  MODE: 'development',
};

describe('AgentEnvironmentEditor', () => {
  const onEnvChange = vi.fn();

  beforeEach(() => {
    onEnvChange.mockReset();
    onEnvChange.mockResolvedValue(undefined);
  });

  it('shows ordinary values while hiding product-managed keys and values', () => {
    render(<AgentEnvironmentEditor env={env} onEnvChange={onEnvChange} />);

    expect(screen.getByText('MODE')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.queryByText('GITHUB_CRED_KEY')).not.toBeInTheDocument();
    expect(screen.queryByText('github-credential-ref')).not.toBeInTheDocument();
    expect(screen.queryByText('claude-credential-ref')).not.toBeInTheDocument();
    expect(screen.queryByText('["owner/repo"]')).not.toBeInTheDocument();
  });

  it('adds and overwrites ordinary values without dropping managed keys', async () => {
    render(<AgentEnvironmentEditor env={env} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'REGION' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'cn-east' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith({ ...env, REGION: 'cn-east' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('REGION saved');

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'MODE' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'production' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(onEnvChange).toHaveBeenLastCalledWith({ ...env, MODE: 'production' });
    });
  });

  it('removes only the selected ordinary key', async () => {
    render(<AgentEnvironmentEditor env={env} onEnvChange={onEnvChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove MODE' }));

    const { MODE: _removed, ...managedEnv } = env;
    await waitFor(() => {
      expect(onEnvChange).toHaveBeenCalledWith(managedEnv);
    });
    expect(await screen.findByRole('status')).toHaveTextContent('MODE removed');
  });

  it.each([
    ['lowercase name', 'mode', 'Use uppercase names'],
    ['runtime key', 'PATH', 'PATH is reserved'],
    ['managed key', 'GITHUB_REPOS', 'GITHUB_REPOS is managed'],
    ['security-sensitive key', 'SERVICE_API_KEY', 'SERVICE_API_KEY looks sensitive'],
  ])('blocks a %s before persistence', (_case, key, message) => {
    render(<AgentEnvironmentEditor env={env} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: key } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'unsafe' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onEnvChange).not.toHaveBeenCalled();
  });

  it('keeps the draft and exposes a failure when persistence rejects', async () => {
    onEnvChange.mockRejectedValue(new Error('offline'));
    render(<AgentEnvironmentEditor env={env} onEnvChange={onEnvChange} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'REGION' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), {
      target: { value: 'cn-east' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('REGION');
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('cn-east');
  });
});

describe('sanitizeAgentEnv', () => {
  it('retains product-managed references while dropping invalid, reserved, and sensitive keys', () => {
    expect(
      sanitizeAgentEnv({
        FEATURE_MODE: 'enabled',
        GITHUB_CRED_KEY: 'credential-ref',
        LOBEHUB_JWT: 'unsafe',
        SERVICE_TOKEN: 'unsafe',
        lowercase: 'invalid',
      }),
    ).toEqual({ FEATURE_MODE: 'enabled', GITHUB_CRED_KEY: 'credential-ref' });
  });
});
