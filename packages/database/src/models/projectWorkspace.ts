import type { WorkspaceInitResult } from '@lobechat/types/src/device';
import type {
  ProjectWorkspaceEnvRecord,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';
import type { ProjectWorkspaceSkillPolicy } from '@lobechat/types/src/projectWorkspace/skillAdapter';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  buildWorkspaceScopeKey,
  isAbsoluteFilesystemPath,
  normalizeRootPath,
} from '@/helpers/executionContext';

import type { NewProjectWorkspace, ProjectWorkspaceRow } from '../schemas/projectWorkspace';
import { projectWorkspaces } from '../schemas/projectWorkspace';
import type { LobeChatDatabase } from '../type';

export interface GetOrCreateProjectWorkspaceParams {
  deviceId?: string | null;
  displayName?: string | null;
  kind: WorkspaceKind;
  repoType?: 'git' | 'github' | null;
  rootPath: string;
  scan?: WorkspaceInitResult | null;
  scannedAt?: Date | null;
  skillPolicy?: ProjectWorkspaceSkillPolicy | null;
  /** Organization workspace provenance; set only when the row is first created. */
  workspaceId?: string | null;
}

export interface UpdateProjectWorkspaceParams {
  displayName?: string | null;
  repoType?: 'git' | 'github' | null;
  scan?: WorkspaceInitResult | null;
  scannedAt?: Date | null;
  skillPolicy?: ProjectWorkspaceSkillPolicy | null;
}

export interface ProjectWorkspaceDTO {
  createdAt: Date;
  deviceId?: string;
  displayName?: string;
  envFiles: string[];
  envKeys: Array<{ key: string; secret: boolean }>;
  id: string;
  kind: WorkspaceKind;
  lastUsedAt: Date;
  repoType?: 'git' | 'github';
  rootPath: string;
  scan?: WorkspaceInitResult;
  scannedAt?: Date;
  skillPolicy?: ProjectWorkspaceSkillPolicy;
  updatedAt: Date;
}

const assertValidIdentity = (params: {
  deviceId?: string | null;
  kind: WorkspaceKind;
  rootPath: string;
}) => {
  if (!isAbsoluteFilesystemPath(params.rootPath)) {
    throw new Error('Workspace rootPath must be absolute');
  }

  if (params.kind === 'sandbox') {
    if (params.deviceId || normalizeRootPath(params.rootPath) !== '/workspace') {
      throw new Error('Sandbox workspaces must use /workspace without a device');
    }
    return;
  }

  if (!params.deviceId) {
    throw new Error(`${params.kind} workspaces require a deviceId`);
  }
};

/** User-scoped persistence for stable execution roots. */
export class ProjectWorkspaceModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getOrCreate = async (params: GetOrCreateProjectWorkspaceParams): Promise<ProjectWorkspaceRow> => {
    assertValidIdentity(params);

    const rootPath = normalizeRootPath(params.rootPath);
    const defaultDisplayName =
      params.kind === 'sandbox'
        ? 'Sandbox'
        : rootPath.split('/').findLast(Boolean) || rootPath;
    const scopeKey = buildWorkspaceScopeKey({
      deviceId: params.deviceId ?? undefined,
      kind: params.kind,
      rootPath,
    });
    const now = new Date();
    const insertValue: NewProjectWorkspace = {
      deviceId: params.deviceId ?? null,
      displayName: params.displayName ?? defaultDisplayName,
      kind: params.kind,
      lastUsedAt: now,
      repoType: params.repoType,
      rootPath,
      scan: params.scan,
      scannedAt: params.scannedAt,
      scopeKey,
      skillPolicy: params.skillPolicy,
      userId: this.userId,
      workspaceId: params.workspaceId,
    };

    const [row] = await this.db
      .insert(projectWorkspaces)
      .values(insertValue)
      .onConflictDoUpdate({
        set: {
          ...(params.displayName !== undefined && { displayName: params.displayName }),
          lastUsedAt: now,
          ...(params.repoType !== undefined && { repoType: params.repoType }),
          ...(params.scan !== undefined && { scan: params.scan }),
          ...(params.scannedAt !== undefined && { scannedAt: params.scannedAt }),
          ...(params.skillPolicy !== undefined && { skillPolicy: params.skillPolicy }),
          updatedAt: now,
        },
        target: [projectWorkspaces.userId, projectWorkspaces.scopeKey],
      })
      .returning();

    return row;
  };

  findById = async (id: string): Promise<ProjectWorkspaceRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.id, id), eq(projectWorkspaces.userId, this.userId)))
      .limit(1);
    return row;
  };

  findByIds = async (ids: string[]): Promise<ProjectWorkspaceRow[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(projectWorkspaces)
      .where(and(eq(projectWorkspaces.userId, this.userId), inArray(projectWorkspaces.id, ids)));
  };

  findByScopeKey = async (scopeKey: string): Promise<ProjectWorkspaceRow | undefined> => {
    const [row] = await this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(eq(projectWorkspaces.userId, this.userId), eq(projectWorkspaces.scopeKey, scopeKey)),
      )
      .limit(1);
    return row;
  };

  list = async (
    filter: { deviceId?: string; kind?: WorkspaceKind } = {},
  ): Promise<ProjectWorkspaceRow[]> => {
    return this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.userId, this.userId),
          filter.deviceId ? eq(projectWorkspaces.deviceId, filter.deviceId) : undefined,
          filter.kind ? eq(projectWorkspaces.kind, filter.kind) : undefined,
        ),
      )
      .orderBy(desc(projectWorkspaces.lastUsedAt), desc(projectWorkspaces.createdAt));
  };

  touch = async (id: string, now = new Date()): Promise<void> => {
    await this.db
      .update(projectWorkspaces)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(and(eq(projectWorkspaces.id, id), eq(projectWorkspaces.userId, this.userId)));
  };

  update = async (id: string, value: UpdateProjectWorkspaceParams): Promise<void> => {
    await this.db
      .update(projectWorkspaces)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectWorkspaces.id, id), eq(projectWorkspaces.userId, this.userId)));
  };

  updateScan = async (
    id: string,
    scan: WorkspaceInitResult | null,
    scannedAt: Date | null,
  ): Promise<void> => {
    await this.update(id, { scan, scannedAt });
  };

  /** Server-only environment write. Values must already be encrypted by the environment adapter. */
  updateEnvironment = async (
    id: string,
    value: { env?: ProjectWorkspaceEnvRecord | null; envFiles?: string[] },
  ): Promise<void> => {
    await this.db
      .update(projectWorkspaces)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectWorkspaces.id, id), eq(projectWorkspaces.userId, this.userId)));
  };
}

export const toWorkspaceRef = (row: ProjectWorkspaceRow): WorkspaceRef => ({
  deviceId: row.deviceId ?? undefined,
  displayName: row.displayName ?? undefined,
  id: row.id,
  kind: row.kind,
  rootPath: row.rootPath,
});

/** Browser-safe projection. In particular, the encrypted env values never cross this seam. */
export const toProjectWorkspaceDTO = (row: ProjectWorkspaceRow): ProjectWorkspaceDTO => ({
  createdAt: row.createdAt,
  deviceId: row.deviceId ?? undefined,
  displayName: row.displayName ?? undefined,
  envFiles: row.envFiles,
  envKeys: Object.entries(row.env ?? {}).map(([key, entry]) => ({ key, secret: entry.secret })),
  id: row.id,
  kind: row.kind,
  lastUsedAt: row.lastUsedAt,
  repoType: row.repoType ?? undefined,
  rootPath: row.rootPath,
  scan: row.scan ?? undefined,
  scannedAt: row.scannedAt ?? undefined,
  skillPolicy: row.skillPolicy ?? undefined,
  updatedAt: row.updatedAt,
});
