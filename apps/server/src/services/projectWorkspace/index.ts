import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type { WorkspaceInitResult } from '@lobechat/types/src/device';
import type { ProjectWorkspaceSkillPolicy } from '@lobechat/types/src/projectWorkspace/skillAdapter';
import { TRPCError } from '@trpc/server';

import type {
  GetOrCreateProjectWorkspaceParams,
  ProjectWorkspaceDTO,
  ProjectWorkspaceModel,
} from '@/database/models/projectWorkspace';
import { toProjectWorkspaceDTO } from '@/database/models/projectWorkspace';
import { isAbsoluteFilesystemPath } from '@/helpers/executionContext';

import {
  type BindTopicWorkspaceResult,
  type CaptureTopicTargetParams,
  type TopicWorkspaceBindingStore,
  type TopicWorkspaceState,
  WorkspaceAlreadyBoundError,
} from './bindingStore';

export type {
  BindTopicWorkspaceParams,
  BindTopicWorkspaceResult,
  CaptureTopicTargetParams,
  TopicWorkspaceBindingStore,
  TopicWorkspaceState,
} from './bindingStore';
export { DatabaseTopicWorkspaceBindingStore, WorkspaceAlreadyBoundError } from './bindingStore';

interface ProjectWorkspaceServiceDependencies {
  bindingStore: TopicWorkspaceBindingStore;
  resolveDeviceWorkspacePath?: (params: {
    deviceId: string;
    path: string;
  }) => Promise<{ repoType?: 'git' | 'github'; rootPath: string } | undefined>;
  workspaceModel: ProjectWorkspaceModel;
}

const workspaceDirectoryUnavailable = () =>
  new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: 'The selected directory does not exist or cannot be verified on the target device',
  });

/**
 * The only service allowed to bind a topic to a persisted workspace.
 * Merely resolving an unbound topic is read-only: recommendations, device
 * defaults, message text, code blocks, and attachments never call a write path.
 */
export class ProjectWorkspaceService {
  constructor(private readonly deps: ProjectWorkspaceServiceDependencies) {}

  list = async (
    filter: Parameters<ProjectWorkspaceModel['list']>[0] = {},
  ): Promise<ProjectWorkspaceDTO[]> =>
    (await this.deps.workspaceModel.list(filter)).map(toProjectWorkspaceDTO);

  get = async (id: string): Promise<ProjectWorkspaceDTO | undefined> => {
    const row = await this.deps.workspaceModel.findById(id);
    return row ? toProjectWorkspaceDTO(row) : undefined;
  };

  getOrCreate = async (params: GetOrCreateProjectWorkspaceParams): Promise<ProjectWorkspaceDTO> => {
    if (params.kind !== 'device') {
      return toProjectWorkspaceDTO(await this.deps.workspaceModel.getOrCreate(params));
    }

    if (!params.deviceId || !this.deps.resolveDeviceWorkspacePath) {
      throw workspaceDirectoryUnavailable();
    }
    const resolved = await this.deps.resolveDeviceWorkspacePath({
      deviceId: params.deviceId,
      path: params.rootPath,
    });
    if (!resolved || !isAbsoluteFilesystemPath(resolved.rootPath)) {
      throw workspaceDirectoryUnavailable();
    }

    return toProjectWorkspaceDTO(
      await this.deps.workspaceModel.getOrCreate({
        ...params,
        repoType: resolved.repoType ?? params.repoType,
        rootPath: resolved.rootPath,
      }),
    );
  };

  update = async (
    id: string,
    value: {
      displayName?: string | null;
      envFiles?: string[];
      repoType?: 'git' | 'github' | null;
      skillPolicy?: ProjectWorkspaceSkillPolicy | null;
    },
  ): Promise<ProjectWorkspaceDTO | undefined> => {
    await this.deps.workspaceModel.update(id, value);
    return this.get(id);
  };

  updateScan = async (
    id: string,
    scan: WorkspaceInitResult | null,
    scannedAt: Date | null,
  ): Promise<void> => this.deps.workspaceModel.updateScan(id, scan, scannedAt);

  /** Read-only resolution. It deliberately never binds or creates scratch state. */
  resolveTopic = async (topicId: string): Promise<TopicWorkspaceState | undefined> =>
    this.deps.bindingStore.getState(topicId);

  captureTarget = async (params: Omit<CaptureTopicTargetParams, 'now'> & { now?: Date }) =>
    this.deps.bindingStore.captureTargetIfAbsent(params);

  captureTargetIfAbsent = async (params: Omit<CaptureTopicTargetParams, 'now'> & { now?: Date }) =>
    this.deps.bindingStore.captureTargetIfAbsent(params);

  bindTopic = async (params: {
    now?: Date;
    target?: DeviceExecutionTarget;
    topicId: string;
    workspaceId: string;
  }): Promise<BindTopicWorkspaceResult> => this.deps.bindingStore.bind(params);

  /**
   * Explicit A2 seam: call only after a device tool that required a default cwd
   * succeeded and returned its deterministic topic scratch root.
   */
  bindScratchAfterToolSuccess = async (params: {
    deviceId: string;
    rootPath: string;
    target?: 'device' | 'local';
    topicId: string;
    toolSucceeded: true;
    workspaceId?: string | null;
  }): Promise<BindTopicWorkspaceResult> => {
    if (params.toolSucceeded !== true) {
      throw new Error('Scratch binding requires a successful cwd-dependent tool result');
    }
    const row = await this.deps.workspaceModel.getOrCreate({
      deviceId: params.deviceId,
      kind: 'scratch',
      rootPath: params.rootPath,
      workspaceId: params.workspaceId,
    });
    try {
      return await this.deps.bindingStore.bind({
        target: params.target,
        topicId: params.topicId,
        workspaceId: row.id,
      });
    } catch (error) {
      // A user may bind a formal workspace while the first cwd-dependent tool
      // is running in its prepared scratch directory. The topic CAS must win.
      // Preserve the candidate row as cleanup evidence; the owning runtime
      // deletes it only after device cleanup confirms the canonical root.
      if (error instanceof WorkspaceAlreadyBoundError) {
        throw new WorkspaceAlreadyBoundError(row.id);
      }
      throw error;
    }
  };

  /** Explicit sandbox selection; never used as a fallback from local/device. */
  bindExplicitSandbox = async (params: {
    topicId: string;
    workspaceId?: string | null;
  }): Promise<BindTopicWorkspaceResult> => {
    const row = await this.deps.workspaceModel.getOrCreate({
      kind: 'sandbox',
      rootPath: '/workspace',
      workspaceId: params.workspaceId,
    });
    return this.deps.bindingStore.bind({
      target: 'sandbox',
      topicId: params.topicId,
      workspaceId: row.id,
    });
  };
}
