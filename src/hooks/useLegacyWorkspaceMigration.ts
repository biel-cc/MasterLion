import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { useEffect } from 'react';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
import { projectWorkspaceService } from '@/services/projectWorkspace';
import { useAgentStore } from '@/store/agent';
import { useProjectWorkspaceStore } from '@/store/projectWorkspace';

export interface LegacyAgentWorkspaceMigrationInput {
  agencyConfig?: LobeAgentAgencyConfig;
  agentId: string;
  deviceId: string;
  localPath?: string;
}

export interface LegacyAgentWorkspaceMigrationDependencies {
  clearLocalPath: () => Promise<void>;
  getOrCreate: (input: { deviceId: string; rootPath: string }) => Promise<ProjectWorkspaceItem>;
  updateAgencyConfig: (config: LobeAgentAgencyConfig) => Promise<void>;
  upsertWorkspace: (workspace: ProjectWorkspaceItem) => void;
}

/** One-way compatibility bridge. Legacy cwd values are deleted only after durable writes succeed. */
export const migrateLegacyAgentWorkspace = async (
  input: LegacyAgentWorkspaceMigrationInput,
  dependencies: LegacyAgentWorkspaceMigrationDependencies,
): Promise<ProjectWorkspaceItem | undefined> => {
  const { agencyConfig = {}, deviceId } = input;
  const legacyPath = agencyConfig.workingDirByDevice?.[deviceId] ?? input.localPath;
  const existingWorkspaceId = agencyConfig.defaultWorkspaceByDevice?.[deviceId];
  if (!legacyPath && !existingWorkspaceId) return;

  const workspace =
    !existingWorkspaceId && legacyPath
      ? await dependencies.getOrCreate({ deviceId, rootPath: legacyPath })
      : undefined;
  const workspaceId = existingWorkspaceId ?? workspace?.id;
  if (!workspaceId) return;

  const workingDirByDevice = { ...agencyConfig.workingDirByDevice };
  delete workingDirByDevice[deviceId];
  const nextAgencyConfig: LobeAgentAgencyConfig = {
    ...agencyConfig,
    defaultWorkspaceByDevice: {
      ...agencyConfig.defaultWorkspaceByDevice,
      [deviceId]: workspaceId,
    },
    workingDirByDevice,
  };

  await dependencies.updateAgencyConfig(nextAgencyConfig);
  if (workspace) dependencies.upsertWorkspace(workspace);
  if (input.localPath) await dependencies.clearLocalPath();
  return workspace;
};

const migrations = new Map<string, Promise<unknown>>();

export const useLegacyWorkspaceMigration = (
  agentId: string | undefined,
  agencyConfig: LobeAgentAgencyConfig | undefined,
  deviceId: string | undefined,
) => {
  const localPath = useAgentStore((state) =>
    agentId ? state.localAgentWorkingDirectoryMap?.[agentId] : undefined,
  );
  const updateAgentConfigById = useAgentStore((state) => state.updateAgentConfigById);
  const updateAgentRuntimeEnvConfigById = useAgentStore(
    (state) => state.updateAgentRuntimeEnvConfigById,
  );
  const upsertWorkspaces = useProjectWorkspaceStore((state) => state.upsertWorkspaces);

  useEffect(() => {
    if (
      !isDesktop ||
      !agentId ||
      !deviceId ||
      typeof updateAgentConfigById !== 'function' ||
      typeof updateAgentRuntimeEnvConfigById !== 'function'
    )
      return;
    const hasLegacy = !!agencyConfig?.workingDirByDevice?.[deviceId] || !!localPath;
    if (!hasLegacy) return;

    const key = `${agentId}:${deviceId}`;
    if (migrations.has(key)) return;
    const migration = migrateLegacyAgentWorkspace(
      { agencyConfig, agentId, deviceId, localPath },
      {
        clearLocalPath: () =>
          updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: undefined }),
        getOrCreate: (input) => projectWorkspaceService.getOrCreateDeviceWorkspace(input),
        updateAgencyConfig: (nextAgencyConfig) =>
          updateAgentConfigById(
            agentId,
            { agencyConfig: nextAgencyConfig },
            {
              replacePaths: [
                'agencyConfig.defaultWorkspaceByDevice',
                'agencyConfig.workingDirByDevice',
              ],
              throwOnError: true,
            },
          ),
        upsertWorkspace: (workspace) => upsertWorkspaces([workspace]),
      },
    )
      .catch(() => {
        // Compatibility migration is retryable and must preserve old data on failure.
      })
      .finally(() => migrations.delete(key));
    migrations.set(key, migration);
  }, [
    agencyConfig,
    agentId,
    deviceId,
    localPath,
    updateAgentConfigById,
    updateAgentRuntimeEnvConfigById,
    upsertWorkspaces,
  ]);

  return localPath;
};
