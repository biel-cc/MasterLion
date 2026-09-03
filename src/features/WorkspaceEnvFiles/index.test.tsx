import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isWorkspaceRelativeEnvFile, WorkspaceEnvFiles } from './index';

const { updateWorkspace } = vi.hoisted(() => ({ updateWorkspace: vi.fn() }));

vi.mock('@/store/projectWorkspace', () => ({
  useProjectWorkspaceStore: (
    selector: (state: { updateWorkspace: typeof updateWorkspace }) => unknown,
  ) => selector({ updateWorkspace }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      ({
        'workspaceEnvFiles.count': `${options?.count}/${options?.max} files`,
        'workspaceEnvFiles.description': 'One workspace-relative path per line',
        'workspaceEnvFiles.invalidPath': `${options?.path} must be relative`,
        'workspaceEnvFiles.label': 'Environment file paths',
        'workspaceEnvFiles.placeholder': '.env',
        'workspaceEnvFiles.save': 'Save files',
        'workspaceEnvFiles.saveError': 'Could not save paths',
        'workspaceEnvFiles.saveSuccess': 'Paths saved',
        'workspaceEnvFiles.title': 'Environment files',
        'workspaceEnvFiles.tooMany': `No more than ${options?.max} files`,
      })[key] ?? key,
  }),
}));

const workspace = {
  envFiles: ['.env'],
  id: 'workspace-1',
  kind: 'device' as const,
  rootPath: '/repo',
};

describe('WorkspaceEnvFiles', () => {
  beforeEach(() => {
    updateWorkspace.mockReset();
  });

  it('shows persisted paths and saves normalized paths through projectWorkspace.update', async () => {
    updateWorkspace.mockResolvedValue({
      ok: true,
      value: { ...workspace, envFiles: ['.env', 'config/development.env'] },
    });
    const { rerender } = render(<WorkspaceEnvFiles workspace={workspace} />);

    const input = screen.getByRole('textbox', { name: 'Environment file paths' });
    expect(input).toHaveValue('.env');

    fireEvent.change(input, { target: { value: ' .env \nconfig/development.env ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save files' }));

    await waitFor(() => {
      expect(updateWorkspace).toHaveBeenCalledWith('workspace-1', {
        envFiles: ['.env', 'config/development.env'],
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Paths saved');
    expect(screen.getByRole('button', { name: 'Save files' })).toBeDisabled();

    rerender(
      <WorkspaceEnvFiles
        workspace={{ ...workspace, envFiles: ['.env', 'config/development.env'] }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Paths saved');
  });

  it.each(['/absolute.env', '../secret.env', 'C:\\secret.env'])(
    'rejects non-workspace path %s without saving',
    (path) => {
      render(<WorkspaceEnvFiles workspace={workspace} />);

      fireEvent.change(screen.getByRole('textbox'), { target: { value: path } });

      expect(screen.getByRole('alert')).toHaveTextContent('must be relative');
      expect(screen.getByRole('button', { name: 'Save files' })).toBeDisabled();
      expect(updateWorkspace).not.toHaveBeenCalled();
    },
  );

  it('enforces the ten-file limit', () => {
    render(<WorkspaceEnvFiles workspace={workspace} />);
    const paths = Array.from({ length: 11 }, (_, index) => `.env.${index}`).join('\n');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: paths } });

    expect(screen.getByRole('alert')).toHaveTextContent('No more than 10 files');
    expect(screen.getByText('11/10 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save files' })).toBeDisabled();
  });

  it('keeps edits and exposes an error when saving fails', async () => {
    updateWorkspace.mockResolvedValue({ code: 'UNKNOWN', ok: false });
    render(<WorkspaceEnvFiles workspace={workspace} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '.env.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save files' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save paths');
    expect(input).toHaveValue('.env.local');
  });

  it('announces the saving state while the update is pending', async () => {
    let finishUpdate: (value: unknown) => void = () => {};
    updateWorkspace.mockReturnValue(
      new Promise((resolve) => {
        finishUpdate = resolve;
      }),
    );
    render(<WorkspaceEnvFiles workspace={workspace} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '.env.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save files' }));

    expect(screen.getByRole('region', { name: 'Environment files' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    finishUpdate({ ok: true, value: { ...workspace, envFiles: ['.env.local'] } });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Environment files' })).toHaveAttribute(
        'aria-busy',
        'false',
      );
    });
  });
});

describe('isWorkspaceRelativeEnvFile', () => {
  it('matches the server path boundary for relative nested files', () => {
    expect(isWorkspaceRelativeEnvFile('config/.env')).toBe(true);
    expect(isWorkspaceRelativeEnvFile('config\\.env')).toBe(true);
    expect(isWorkspaceRelativeEnvFile('config/../.env')).toBe(false);
    expect(isWorkspaceRelativeEnvFile('D:/secrets.env')).toBe(false);
  });
});
