import { index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export const newApiBindings = pgTable(
  'new_api_bindings',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .primaryKey()
      .notNull(),

    newApiUserId: integer('new_api_user_id'),
    encryptedAccessToken: text('encrypted_access_token'),
    managedTokenId: integer('managed_token_id'),
    status: varchar('status', { enum: ['pending', 'active', 'error'], length: 16 })
      .default('pending')
      .notNull(),
    lastSyncedAt: timestamptz('last_synced_at'),
    errorMessage: text('error_message'),
    iamOAuthBindingStatus: varchar('iam_oauth_binding_status', {
      enum: ['unknown', 'pending', 'active', 'error', 'conflict'],
      length: 16,
    })
      .default('unknown')
      .notNull(),
    iamOAuthBindingErrorCode: varchar('iam_oauth_binding_error_code', { length: 64 }),
    iamOAuthBindingError: text('iam_oauth_binding_error'),
    iamOAuthBindingSyncedAt: timestamptz('iam_oauth_binding_synced_at'),

    ...timestamps,
  },
  (table) => [
    index('new_api_bindings_new_api_user_id_idx').on(table.newApiUserId),
    index('new_api_bindings_status_idx').on(table.status),
    index('new_api_bindings_iam_oauth_status_idx').on(table.iamOAuthBindingStatus),
  ],
);

export type NewApiBindingStatusType = (typeof newApiBindings.$inferSelect)['status'];
export type NewApiBindingItem = typeof newApiBindings.$inferSelect;
export type NewNewApiBindingItem = typeof newApiBindings.$inferInsert;
