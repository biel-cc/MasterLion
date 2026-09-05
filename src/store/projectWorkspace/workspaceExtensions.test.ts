/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceExtensions } from '@/features/DeviceWorkspaces';

import enChat from '../../../locales/en-US/chat.json';
import zhChat from '../../../locales/zh-CN/chat.json';
import {
  listWorkspaceExtensions,
  registerWorkspaceExtension,
  resetWorkspaceExtensions,
} from './workspaceExtensions';

vi.mock('@/features/WorkspaceEnv', async () => {
  const { createElement } = await import('react');

  return {
    WorkspaceEnv: ({ workspaceId }: { workspaceId: string }) =>
      createElement('span', { 'data-testid': 'workspace-env-panel' }, workspaceId),
  };
});

vi.mock('@/features/WorkspaceEnvFiles', async () => {
  const { createElement } = await import('react');

  return {
    WorkspaceEnvFiles: ({ workspace }: { workspace: { id: string } }) =>
      createElement('span', { 'data-testid': 'workspace-env-files-panel' }, workspace.id),
  };
});

vi.mock('@/features/WorkspaceSkillsSettings', async () => {
  const { createElement } = await import('react');

  return {
    WorkspaceSkillsSettings: ({ workspace }: { workspace: { id: string } }) =>
      createElement('span', { 'data-testid': 'workspace-skills-panel' }, workspace.id),
  };
});

describe('workspace extension registry', () => {
  afterEach(() => resetWorkspaceExtensions());

  it('starts empty and never assumes an env or skill panel exists', () => {
    expect(listWorkspaceExtensions()).toEqual([]);
  });

  it('registers renderers in order and supports unregistering', () => {
    const unregisterSkills = registerWorkspaceExtension({
      key: 'skills',
      order: 2,
      render: () => null,
    });
    registerWorkspaceExtension({ key: 'env', order: 1, render: () => null });

    expect(listWorkspaceExtensions().map((extension) => extension.key)).toEqual(['env', 'skills']);

    unregisterSkills();
    expect(listWorkspaceExtensions().map((extension) => extension.key)).toEqual(['env']);
  });

  it('replaces an extension registered under the same key', () => {
    registerWorkspaceExtension({ key: 'env', render: () => 'first' });
    registerWorkspaceExtension({ key: 'env', render: () => 'second' });

    expect(listWorkspaceExtensions()).toHaveLength(1);
    expect(
      listWorkspaceExtensions()[0].render({
        deviceId: 'd',
        workspace: { id: 'w', kind: 'device', rootPath: '/p' },
      }),
    ).toBe('second');
  });

  it('mounts registered extension renderers', () => {
    registerWorkspaceExtension({
      key: 'environment',
      render: ({ workspace }) => createElement('span', null, `env:${workspace.id}`),
    });

    render(
      createElement(WorkspaceExtensions, {
        deviceId: 'device-1',
        workspace: { deviceId: 'device-1', id: 'workspace-1', kind: 'device', rootPath: '/app' },
      }),
    );

    expect(screen.getByTestId('workspace-extensions')).toHaveTextContent('env:workspace-1');
  });

  it('lazy-mounts the built-in environment, env-file, and skill settings', async () => {
    const { container } = render(
      createElement(WorkspaceExtensions, {
        deviceId: 'device-1',
        workspace: { deviceId: 'device-1', id: 'workspace-1', kind: 'device', rootPath: '/app' },
      }),
    );
    const [environment, environmentFiles, skills] = Array.from(
      container.querySelectorAll('details'),
    );

    expect(screen.queryByTestId('workspace-env-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-env-files-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-skills-panel')).not.toBeInTheDocument();

    environment.open = true;
    fireEvent(environment, new Event('toggle'));
    environmentFiles.open = true;
    fireEvent(environmentFiles, new Event('toggle'));
    skills.open = true;
    fireEvent(skills, new Event('toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-env-panel')).toHaveTextContent('workspace-1');
      expect(screen.getByTestId('workspace-env-files-panel')).toHaveTextContent('workspace-1');
      expect(screen.getByTestId('workspace-skills-panel')).toHaveTextContent('workspace-1');
    });
  });

  it('ships paired default-cwd recommendation copy without changing canonical defaults', () => {
    expect(enChat['workspaceRuntime.settings.defaultCwdRecommendation']).toContain(
      'does not automatically bind',
    );
    expect(zhChat['workspaceRuntime.settings.defaultCwdRecommendation']).toContain('不会自动关联');
  });
});
