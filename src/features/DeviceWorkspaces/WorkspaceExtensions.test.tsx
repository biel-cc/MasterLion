import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceExtensions from './WorkspaceExtensions';

const { envFilesRender } = vi.hoisted(() => ({
  envFilesRender: vi.fn(({ workspace }: { workspace: { id: string } }) => (
    <DraftEditor id={workspace.id} />
  )),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/WorkspaceEnv', () => ({ WorkspaceEnv: () => null }));
vi.mock('@/features/WorkspaceEnvFiles', () => ({ WorkspaceEnvFiles: envFilesRender }));
vi.mock('@/features/WorkspaceSkillsSettings', () => ({
  WorkspaceSkillsSettings: () => null,
}));
vi.mock('@/services/projectWorkspace', () => ({ projectWorkspaceService: {} }));
vi.mock('@/store/projectWorkspace', () => ({ useWorkspaceExtensions: () => [] }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'workspaceEnv.title': 'Workspace environment',
        'workspaceEnvFiles.title': 'Environment files',
        'workspaceSkills.title': 'Workspace skills',
      })[key] ?? key,
  }),
}));

function DraftEditor({ id }: { id: string }) {
  const [value, setValue] = useState('');
  return (
    <div>
      env files for {id}
      <input aria-label="draft" value={value} onChange={(event) => setValue(event.target.value)} />
    </div>
  );
}

describe('WorkspaceExtensions', () => {
  it('lazy-mounts the real env-files feature from the device workspace panel', () => {
    render(
      <WorkspaceExtensions
        deviceId="device-1"
        workspace={{ id: 'workspace-1', kind: 'device', rootPath: '/repo' }}
      />,
    );

    const summary = screen.getByText('Environment files');
    const details = summary.closest('details')!;
    Object.defineProperty(details, 'open', { configurable: true, value: true });
    fireEvent(details, new Event('toggle'));

    expect(screen.getByText('env files for workspace-1')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unsaved.env' } });
    Object.defineProperty(details, 'open', { configurable: true, value: false });
    fireEvent(details, new Event('toggle'));
    Object.defineProperty(details, 'open', { configurable: true, value: true });
    fireEvent(details, new Event('toggle'));
    expect(screen.getByLabelText('draft')).toHaveValue('unsaved.env');
    expect(envFilesRender).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: expect.objectContaining({ id: 'workspace-1' }) }),
      undefined,
    );
  });
});
