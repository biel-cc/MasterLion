import type { WorkspaceInitResult } from '@lobechat/types/src/device';
import type { ProjectWorkspaceEnvRecord } from '@lobechat/types/src/projectWorkspace';
import type { ProjectWorkspaceSkillPolicy } from '@lobechat/types/src/projectWorkspace/skillAdapter';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

const createProjectWorkspaceId = () => `pws_${createNanoId(12)()}`;

/**
 * A stable, user-level execution root. `workspaceId` records the organization
 * context that created the row, but is deliberately not part of ownership or
 * identity: a physical device directory belongs to the user across org scopes.
 */
export const projectWorkspaces = pgTable(
  'project_workspaces',
  {
    id: text('id').$defaultFn(createProjectWorkspaceId).primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),

    kind: varchar('kind', { enum: ['device', 'sandbox', 'scratch'], length: 16 }).notNull(),
    deviceId: varchar('device_id', { length: 64 }),
    rootPath: text('root_path').notNull(),
    /** Canonical kind/device/root tuple produced by buildWorkspaceScopeKey. */
    scopeKey: text('scope_key').notNull(),

    displayName: text('display_name'),
    repoType: varchar('repo_type', { enum: ['git', 'github'], length: 16 }),

    /** Encrypted-at-rest values. Browser DTOs expose names/secret flags only. */
    env: jsonb('env').$type<ProjectWorkspaceEnvRecord>(),
    envFiles: jsonb('env_files').$type<string[]>().default([]).notNull(),
    skillPolicy: jsonb('skill_policy').$type<ProjectWorkspaceSkillPolicy>(),

    scan: jsonb('scan').$type<WorkspaceInitResult>(),
    scannedAt: timestamptz('scanned_at'),
    lastUsedAt: timestamptz('last_used_at').defaultNow().notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_workspaces_user_scope_key_unique').on(t.userId, t.scopeKey),
    index('project_workspaces_user_id_idx').on(t.userId),
    index('project_workspaces_device_id_idx').on(t.deviceId),
    check(
      'project_workspaces_identity_check',
      sql`(
        (${t.kind} = 'sandbox' AND ${t.deviceId} IS NULL AND ${t.rootPath} = '/workspace') OR
        (${t.kind} IN ('device', 'scratch') AND ${t.deviceId} IS NOT NULL)
      )`,
    ),
  ],
);

export type NewProjectWorkspace = typeof projectWorkspaces.$inferInsert;
export type ProjectWorkspaceRow = typeof projectWorkspaces.$inferSelect;
