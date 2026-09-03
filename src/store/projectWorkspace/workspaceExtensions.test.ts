import { afterEach, describe, expect, it } from 'vitest';

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
});
