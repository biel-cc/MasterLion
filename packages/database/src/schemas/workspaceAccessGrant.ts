import type { PathAccessMode } from '@lobechat/types/src/executionContext';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { topics } from './topic';
import { users } from './user';

export interface WorkspaceGrantRequestEvidence {
  messageId?: string;
  reason?: string;
  toolCallId?: string;
}

const createWorkspaceAccessGrantId = () => `wag_${createNanoId(12)()}`;

/** Persisted topic-level consent. Operation-only consent never enters this table. */
export const workspaceAccessGrants = pgTable(
  'workspace_access_grants',
  {
    id: text('id').$defaultFn(createWorkspaceAccessGrantId).primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    deviceId: varchar('device_id', { length: 64 }).notNull(),
    rootPath: text('root_path').notNull(),
    modes: jsonb('modes').$type<PathAccessMode[]>().notNull(),
    scope: varchar('scope', { enum: ['topic'], length: 16 })
      .default('topic')
      .notNull(),
    requestedVia: jsonb('requested_via')
      .$type<WorkspaceGrantRequestEvidence>()
      .default({})
      .notNull(),

    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('workspace_access_grants_scope_unique').on(
      t.userId,
      t.topicId,
      t.deviceId,
      t.rootPath,
    ),
    index('workspace_access_grants_topic_device_idx').on(t.userId, t.topicId, t.deviceId),
    index('workspace_access_grants_expires_at_idx').on(t.expiresAt),
    check('workspace_access_grants_scope_check', sql`${t.scope} = 'topic'`),
    check(
      'workspace_access_grants_modes_check',
      sql`jsonb_typeof(${t.modes}) = 'array'
        AND jsonb_array_length(${t.modes}) > 0
        AND ${t.modes} <@ '["read", "write", "exec"]'::jsonb`,
    ),
  ],
);

export type NewWorkspaceAccessGrant = typeof workspaceAccessGrants.$inferInsert;
export type WorkspaceAccessGrantRow = typeof workspaceAccessGrants.$inferSelect;
