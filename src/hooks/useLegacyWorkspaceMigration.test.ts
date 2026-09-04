import { describe, expect, it, vi } from 'vitest';

import {
  migrateLegacyAgentWorkspace,
  shouldRunLegacyWorkspaceMigration,
} from './useLegacyWorkspaceMigration';

describe('migrateLegacyAgentWorkspace', () => {
  it('waits for workspace capability discovery and never migrates against an old server', () => {
    const ready = {
      agentId: 'agent-a',
      deviceId: 'device-a',
      hasLegacy: true,
      isDesktopRuntime: true,
      isWorkspacesInit: true,
      seamAvailable: true,
    };

    expect(shouldRunLegacyWorkspaceMigration(ready)).toBe(true);
    expect(shouldRunLegacyWorkspaceMigration({ ...ready, isWorkspacesInit: false })).toBe(false);
    expect(shouldRunLegacyWorkspaceMigration({ ...ready, seamAvailable: false })).toBe(false);
  });

  it('creates a formal workspace, stores its id, and removes both legacy cwd slots', async () => {
    const clearLocalPath = vi.fn(async () => {});
    const getOrCreate = vi.fn(async () => ({
      deviceId: 'device-a',
      id: 'workspace-a',
      kind: 'device' as const,
      rootPath: '/projects/legacy',
    }));
    const updateAgencyConfig = vi.fn(async () => {});
    const upsertWorkspace = vi.fn();

    await migrateLegacyAgentWorkspace(
      {
        agencyConfig: {
          executionTargetByPlatform: { desktop: 'local' },
          workingDirByDevice: { 'device-a': '/projects/legacy', 'other': '/projects/other' },
        },
        agentId: 'agent-a',
        deviceId: 'device-a',
        localPath: '/projects/local-storage',
      },
      { clearLocalPath, getOrCreate, updateAgencyConfig, upsertWorkspace },
    );

    expect(getOrCreate).toHaveBeenCalledWith({
      deviceId: 'device-a',
      rootPath: '/projects/legacy',
    });
    expect(updateAgencyConfig).toHaveBeenCalledWith({
      defaultWorkspaceByDevice: { 'device-a': 'workspace-a' },
      executionTargetByPlatform: { desktop: 'local' },
      workingDirByDevice: { other: '/projects/other' },
    });
    expect(upsertWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-a', rootPath: '/projects/legacy' }),
    );
    expect(clearLocalPath).toHaveBeenCalledOnce();
  });

  it('keeps legacy data intact when formal persistence fails', async () => {
    const clearLocalPath = vi.fn(async () => {});
    const updateAgencyConfig = vi.fn(async () => {
      throw new Error('server unavailable');
    });

    await expect(
      migrateLegacyAgentWorkspace(
        {
          agencyConfig: { workingDirByDevice: { 'device-a': '/projects/legacy' } },
          agentId: 'agent-a',
          deviceId: 'device-a',
        },
        {
          clearLocalPath,
          getOrCreate: vi.fn(async () => ({
            deviceId: 'device-a',
            id: 'workspace-a',
            kind: 'device' as const,
            rootPath: '/projects/legacy',
          })),
          updateAgencyConfig,
          upsertWorkspace: vi.fn(),
        },
      ),
    ).rejects.toThrow('server unavailable');

    expect(clearLocalPath).not.toHaveBeenCalled();
  });

  it('clears legacy slots without creating an orphan when a formal default already exists', async () => {
    const clearLocalPath = vi.fn(async () => {});
    const getOrCreate = vi.fn();
    const updateAgencyConfig = vi.fn(async () => {});
    const upsertWorkspace = vi.fn();

    await migrateLegacyAgentWorkspace(
      {
        agencyConfig: {
          defaultWorkspaceByDevice: { 'device-a': 'workspace-existing' },
          workingDirByDevice: { 'device-a': '/projects/legacy' },
        },
        agentId: 'agent-a',
        deviceId: 'device-a',
        localPath: '/projects/local-storage',
      },
      { clearLocalPath, getOrCreate, updateAgencyConfig, upsertWorkspace },
    );

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(updateAgencyConfig).toHaveBeenCalledWith({
      defaultWorkspaceByDevice: { 'device-a': 'workspace-existing' },
      workingDirByDevice: {},
    });
    expect(upsertWorkspace).not.toHaveBeenCalled();
    expect(clearLocalPath).toHaveBeenCalledOnce();
  });
});
