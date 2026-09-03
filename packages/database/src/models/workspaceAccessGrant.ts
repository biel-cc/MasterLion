import type { PathAccessMode, WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';

import { normalizeRootPath } from '@/helpers/executionContext';

import { topics } from '../schemas/topic';
import type {
  WorkspaceAccessGrantRow,
  WorkspaceGrantRequestEvidence,
} from '../schemas/workspaceAccessGrant';
import { workspaceAccessGrants } from '../schemas/workspaceAccessGrant';
import type { LobeChatDatabase } from '../type';

export interface UpsertWorkspaceAccessGrantParams {
  deviceId: string;
  expiresAt?: Date | null;
  modes: PathAccessMode[];
  requestedVia: WorkspaceGrantRequestEvidence;
  rootPath: string;
  topicId: string;
}

/** User-owned, topic/device-scoped grant persistence. */
export class WorkspaceAccessGrantModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  upsert = async (
    params: UpsertWorkspaceAccessGrantParams,
    now = new Date(),
  ): Promise<WorkspaceAccessGrantRow> => {
    const rootPath = normalizeRootPath(params.rootPath);
    const [row] = await this.db
      .insert(workspaceAccessGrants)
      .values({
        deviceId: params.deviceId,
        expiresAt: params.expiresAt,
        modes: params.modes,
        requestedVia: params.requestedVia,
        rootPath,
        topicId: params.topicId,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          expiresAt: params.expiresAt,
          modes: params.modes,
          requestedVia: params.requestedVia,
          revokedAt: null,
          updatedAt: now,
        },
        target: [
          workspaceAccessGrants.userId,
          workspaceAccessGrants.topicId,
          workspaceAccessGrants.deviceId,
          workspaceAccessGrants.rootPath,
        ],
      })
      .returning();

    return row;
  };

  findById = async (params: {
    deviceId: string;
    id: string;
    topicId: string;
  }): Promise<WorkspaceAccessGrantRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(workspaceAccessGrants)
      .where(
        and(
          eq(workspaceAccessGrants.id, params.id),
          eq(workspaceAccessGrants.userId, this.userId),
          eq(workspaceAccessGrants.topicId, params.topicId),
          eq(workspaceAccessGrants.deviceId, params.deviceId),
        ),
      )
      .limit(1);
    return row;
  };

  listActive = async (
    params: { deviceId: string; topicId: string },
    now = new Date(),
  ): Promise<WorkspaceAccessGrantRow[]> => {
    return this.db
      .select({
        accessedAt: workspaceAccessGrants.accessedAt,
        createdAt: workspaceAccessGrants.createdAt,
        deviceId: workspaceAccessGrants.deviceId,
        expiresAt: workspaceAccessGrants.expiresAt,
        id: workspaceAccessGrants.id,
        lastUsedAt: workspaceAccessGrants.lastUsedAt,
        modes: workspaceAccessGrants.modes,
        requestedVia: workspaceAccessGrants.requestedVia,
        revokedAt: workspaceAccessGrants.revokedAt,
        rootPath: workspaceAccessGrants.rootPath,
        scope: workspaceAccessGrants.scope,
        topicId: workspaceAccessGrants.topicId,
        updatedAt: workspaceAccessGrants.updatedAt,
        userId: workspaceAccessGrants.userId,
      })
      .from(workspaceAccessGrants)
      .innerJoin(topics, eq(topics.id, workspaceAccessGrants.topicId))
      .where(
        and(
          eq(workspaceAccessGrants.userId, this.userId),
          eq(workspaceAccessGrants.topicId, params.topicId),
          eq(workspaceAccessGrants.deviceId, params.deviceId),
          isNull(workspaceAccessGrants.revokedAt),
          or(isNull(workspaceAccessGrants.expiresAt), gt(workspaceAccessGrants.expiresAt, now)),
          or(isNull(topics.status), ne(topics.status, 'archived')),
        ),
      );
  };

  revoke = async (
    params: { deviceId: string; id: string; topicId: string },
    now = new Date(),
  ): Promise<WorkspaceAccessGrantRow | undefined> => {
    const [row] = await this.db
      .update(workspaceAccessGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(workspaceAccessGrants.id, params.id),
          eq(workspaceAccessGrants.userId, this.userId),
          eq(workspaceAccessGrants.topicId, params.topicId),
          eq(workspaceAccessGrants.deviceId, params.deviceId),
        ),
      )
      .returning();
    return row;
  };

  touch = async (
    params: { deviceId: string; id: string; topicId: string },
    now = new Date(),
  ): Promise<void> => {
    await this.db
      .update(workspaceAccessGrants)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(
        and(
          eq(workspaceAccessGrants.id, params.id),
          eq(workspaceAccessGrants.userId, this.userId),
          eq(workspaceAccessGrants.topicId, params.topicId),
          eq(workspaceAccessGrants.deviceId, params.deviceId),
          isNull(workspaceAccessGrants.revokedAt),
          or(isNull(workspaceAccessGrants.expiresAt), gt(workspaceAccessGrants.expiresAt, now)),
        ),
      );
  };
}

export const toWorkspaceAccessGrant = (row: WorkspaceAccessGrantRow): WorkspaceAccessGrant => ({
  createdAt: row.createdAt.toISOString(),
  deviceId: row.deviceId,
  expiresAt: row.expiresAt?.toISOString(),
  id: row.id,
  lastUsedAt: row.lastUsedAt?.toISOString(),
  modes: row.modes,
  requestedVia: row.requestedVia,
  revokedAt: row.revokedAt?.toISOString(),
  rootPath: row.rootPath,
  scope: 'topic',
  topicId: row.topicId,
  userId: row.userId,
});
