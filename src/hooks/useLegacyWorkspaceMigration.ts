import { isDesktop } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { useEffect } from 'react';

import type { ProjectWorkspaceItem } from '@/services/projectWorkspace';
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

export interface LegacyWorkspaceMigrationGate {
  agentId?: string;
  deviceId?: string;
  hasLegacy: boolean;
  isDesktopRuntime: boolean;
  isWorkspacesInit: boolean;
  seamAvailable: boolean;
}

/** Migration is destructive, so wait until the formal workspace seam is positively available. */
export const shouldRunLegacyWorkspaceMigration = ({
  agentId,
  deviceId,
  hasLegacy,
  isDesktopRuntime,
  isWorkspacesInit,
  seamAvailable,
}: LegacyWorkspaceMigrationGate): boolean =>
  isDesktopRuntime && isWorkspacesInit && seamAvailable && !!agentId && !!deviceId && hasLegacy;

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
  const getOrCreateDeviceWorkspace = useProjectWorkspaceStore(
    (state) => state.getOrCreateDeviceWorkspace,
  );
  const isWorkspacesInit = useProjectWorkspaceStore((state) => state.isWorkspacesInit);
  const seamAvailable = useProjectWorkspaceStore((state) => state.seamAvailable);
  const upsertWorkspaces = useProjectWorkspaceStore((state) => state.upsertWorkspaces);

  useEffect(() => {
    const hasLegacy = !!agencyConfig?.workingDirByDevice?.[deviceId ?? ''] || !!localPath;
    if (
      !shouldRunLegacyWorkspaceMigration({
        agentId,
        deviceId,
        hasLegacy,
        isDesktopRuntime: isDesktop,
        isWorkspacesInit,
        seamAvailable,
      }) ||
      typeof updateAgentConfigById !== 'function' ||
      typeof updateAgentRuntimeEnvConfigById !== 'function'
    )
      return;
    // `shouldRunLegacyWorkspaceMigration` checks both ids; repeat the narrow for TypeScript.
    if (!agentId || !deviceId) return;

    const key = `${agentId}:${deviceId}`;
    if (migrations.has(key)) return;
    const migration = migrateLegacyAgentWorkspace(
      { agencyConfig, agentId, deviceId, localPath },
      {
        clearLocalPath: () =>
          updateAgentRuntimeEnvConfigById(agentId, { workingDirectory: undefined }),
        getOrCreate: async (input) => {
          const outcome = await getOrCreateDeviceWorkspace(input);
          if (!outcome.ok) throw new Error(outcome.message ?? outcome.code);
          return outcome.value;
        },
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
    getOrCreateDeviceWorkspace,
    isWorkspacesInit,
    localPath,
    seamAvailable,
    updateAgentConfigById,
    updateAgentRuntimeEnvConfigById,
    upsertWorkspaces,
  ]);

  return localPath;
};
