/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import enChat from '../../../locales/en-US/chat.json';
import zhChat from '../../../locales/zh-CN/chat.json';
import WorkspaceExtensions from '../../routes/(main)/settings/devices/features/WorkspaceExtensions';
import {
  listWorkspaceExtensions,
  registerWorkspaceExtension,
  resetWorkspaceExtensions,
} from './workspaceExtensions';

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

  it('mounts registered extension renderers without importing their owning features', () => {
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

  it('ships paired default-cwd recommendation copy without changing canonical defaults', () => {
    expect(enChat['workspaceRuntime.settings.defaultCwdRecommendation']).toContain(
      'does not automatically bind',
    );
    expect(zhChat['workspaceRuntime.settings.defaultCwdRecommendation']).toContain('不会自动绑定');
  });
});
