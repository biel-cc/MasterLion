import type {
  ExecutionAccessRoot,
  PathAccessMode,
  WorkspaceAccessGrant,
} from '@lobechat/types/src/executionContext';
import { TRPCError } from '@trpc/server';

import type { TopicModel } from '@/database/models/topic';
import type { WorkspaceAccessGrantModel } from '@/database/models/workspaceAccessGrant';
import { toWorkspaceAccessGrant } from '@/database/models/workspaceAccessGrant';
import { isAbsoluteFilesystemPath, normalizeRootPath } from '@/helpers/executionContext';

const EXEC_GRANT_TTL_MS = 60 * 60 * 1000;
const ALL_MODES: readonly PathAccessMode[] = ['read', 'write', 'exec'];

export interface GrantWorkspaceAccessParams {
  deviceId: string;
  expiresAt?: Date;
  modes: PathAccessMode[];
  requestedVia?: { messageId?: string; reason?: string; toolCallId?: string };
  rootPath: string;
  topicId: string;
}

interface WorkspaceAccessGrantServiceDependencies {
  clock?: () => Date;
  grantModel: WorkspaceAccessGrantModel;
  topicModel: Pick<TopicModel, 'findById'>;
}

const normalizeModes = (modes: PathAccessMode[]): PathAccessMode[] =>
  ALL_MODES.filter((mode) => modes.includes(mode));

/** Consent lifecycle; filesystem realpath enforcement remains device-side. */
export class WorkspaceAccessGrantService {
  private readonly clock: () => Date;

  constructor(private readonly deps: WorkspaceAccessGrantServiceDependencies) {
    this.clock = deps.clock ?? (() => new Date());
  }

  grant = async (params: GrantWorkspaceAccessParams): Promise<WorkspaceAccessGrant> => {
    const now = this.clock();
    const topic = await this.deps.topicModel.findById(params.topicId);
    if (!topic) throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
    if (topic.status === 'archived') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Archived topics cannot receive grants' });
    }
    if (!params.deviceId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'deviceId is required' });
    }
    if (!isAbsoluteFilesystemPath(params.rootPath)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'rootPath must be absolute' });
    }

    const modes = normalizeModes(params.modes);
    if (modes.length === 0 || modes.length !== new Set(params.modes).size) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least one valid mode is required' });
    }

    let expiresAt = params.expiresAt;
    if (modes.includes('exec')) {
      const latest = new Date(now.getTime() + EXEC_GRANT_TTL_MS);
      if (expiresAt && expiresAt.getTime() > latest.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Exec grants cannot last longer than one hour',
        });
      }
      expiresAt ??= latest;
    }
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Grant expiry must be in the future' });
    }

    const row = await this.deps.grantModel.upsert(
      {
        deviceId: params.deviceId,
        expiresAt,
        modes,
        requestedVia: params.requestedVia ?? {},
        rootPath: normalizeRootPath(params.rootPath),
        topicId: params.topicId,
      },
      now,
    );
    return toWorkspaceAccessGrant(row);
  };

  get = async (params: {
    deviceId: string;
    id: string;
    topicId: string;
  }): Promise<WorkspaceAccessGrant | undefined> => {
    const row = await this.deps.grantModel.findById(params);
    return row ? toWorkspaceAccessGrant(row) : undefined;
  };

  listActive = async (params: {
    deviceId: string;
    topicId: string;
  }): Promise<WorkspaceAccessGrant[]> =>
    (await this.deps.grantModel.listActive(params, this.clock())).map(toWorkspaceAccessGrant);

  buildAccessRoots = async (params: {
    deviceId: string;
    topicId: string;
  }): Promise<ExecutionAccessRoot[]> =>
    (await this.listActive(params)).map((grant) => ({
      deviceId: grant.deviceId,
      expiresAt: grant.expiresAt,
      grantId: grant.id,
      modes: grant.modes,
      rootPath: grant.rootPath,
      scope: 'topic',
      source: 'user-approval',
      topicId: grant.topicId,
    }));

  revoke = async (params: {
    deviceId: string;
    id: string;
    topicId: string;
  }): Promise<WorkspaceAccessGrant | undefined> => {
    const row = await this.deps.grantModel.revoke(params, this.clock());
    return row ? toWorkspaceAccessGrant(row) : undefined;
  };

  touch = async (params: { deviceId: string; id: string; topicId: string }): Promise<void> =>
    this.deps.grantModel.touch(params, this.clock());
}

export { EXEC_GRANT_TTL_MS };
