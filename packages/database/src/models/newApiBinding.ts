import { and, eq, lte } from 'drizzle-orm';

import type { NewApiBindingItem, NewApiBindingStatusType, NewNewApiBindingItem } from '../schemas';
import { aihubReadinessLeases, newApiBindings } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface BaseUpsertNewApiBindingParams {
  encryptedAccessToken?: string | null;
  errorMessage?: string | null;
  iamOAuthBindingError?: string | null;
  iamOAuthBindingErrorCode?: string | null;
  iamOAuthBindingStatus?: NewApiBindingItem['iamOAuthBindingStatus'];
  iamOAuthBindingSyncedAt?: Date | null;
  managedTokenId?: number | null;
}

type UpsertActiveNewApiBindingParams = BaseUpsertNewApiBindingParams & {
  newApiUserId: number;
  status?: Exclude<NewApiBindingStatusType, 'error'>;
};

type UpsertErrorNewApiBindingParams = BaseUpsertNewApiBindingParams & {
  newApiUserId?: number | null;
  status: 'error';
};

export type UpsertNewApiBindingParams =
  | UpsertActiveNewApiBindingParams
  | UpsertErrorNewApiBindingParams;

const isValidNewApiUserId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export interface UpdateNewApiBindingSyncStateParams {
  errorMessage?: string | null;
  lastSyncedAt?: Date | null;
  managedTokenId?: number | null;
  status: NewApiBindingStatusType;
}

export class NewApiBindingModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  find = async (): Promise<NewApiBindingItem | undefined> => {
    return this.db.query.newApiBindings.findFirst({
      where: eq(newApiBindings.userId, this.userId),
    });
  };

  upsertRemoteIdentifiers = async (params: { managedTokenId: number; newApiUserId: number }) => {
    const now = new Date();
    return this.db
      .insert(newApiBindings)
      .values({
        managedTokenId: params.managedTokenId,
        newApiUserId: params.newApiUserId,
        status: 'pending',
        updatedAt: now,
        userId: this.userId,
      })
      .onConflictDoUpdate({
        set: {
          managedTokenId: params.managedTokenId,
          newApiUserId: params.newApiUserId,
          status: 'pending',
          updatedAt: now,
        },
        target: newApiBindings.userId,
      })
      .returning();
  };

  upsert = async (params: UpsertNewApiBindingParams) => {
    const now = new Date();
    const status = params.status ?? 'pending';

    if (status !== 'error' && !isValidNewApiUserId(params.newApiUserId)) {
      throw new Error('newApiUserId is required for non-error NewAPI bindings');
    }

    const values: NewNewApiBindingItem = {
      encryptedAccessToken: params.encryptedAccessToken ?? null,
      errorMessage: params.errorMessage ?? null,
      managedTokenId: params.managedTokenId ?? null,
      ...(params.iamOAuthBindingError !== undefined && {
        iamOAuthBindingError: params.iamOAuthBindingError,
      }),
      ...(params.iamOAuthBindingErrorCode !== undefined && {
        iamOAuthBindingErrorCode: params.iamOAuthBindingErrorCode,
      }),
      ...(params.iamOAuthBindingStatus !== undefined && {
        iamOAuthBindingStatus: params.iamOAuthBindingStatus,
      }),
      ...(params.iamOAuthBindingSyncedAt !== undefined && {
        iamOAuthBindingSyncedAt: params.iamOAuthBindingSyncedAt,
      }),
      newApiUserId: params.newApiUserId ?? null,
      status,
      updatedAt: now,
      userId: this.userId,
    };

    return this.db
      .insert(newApiBindings)
      .values(values)
      .onConflictDoUpdate({
        set: {
          encryptedAccessToken: values.encryptedAccessToken,
          errorMessage: values.errorMessage,
          managedTokenId: values.managedTokenId,
          ...(params.iamOAuthBindingError !== undefined && {
            iamOAuthBindingError: params.iamOAuthBindingError,
          }),
          ...(params.iamOAuthBindingErrorCode !== undefined && {
            iamOAuthBindingErrorCode: params.iamOAuthBindingErrorCode,
          }),
          ...(params.iamOAuthBindingStatus !== undefined && {
            iamOAuthBindingStatus: params.iamOAuthBindingStatus,
          }),
          ...(params.iamOAuthBindingSyncedAt !== undefined && {
            iamOAuthBindingSyncedAt: params.iamOAuthBindingSyncedAt,
          }),
          newApiUserId: values.newApiUserId,
          status: values.status,
          updatedAt: now,
        },
        target: newApiBindings.userId,
      })
      .returning();
  };

  updateSyncState = async (params: UpdateNewApiBindingSyncStateParams) => {
    return this.db
      .update(newApiBindings)
      .set({
        errorMessage: params.errorMessage ?? null,
        lastSyncedAt: params.lastSyncedAt ?? new Date(),
        managedTokenId: params.managedTokenId ?? null,
        status: params.status,
        updatedAt: new Date(),
      })
      .where(eq(newApiBindings.userId, this.userId));
  };
}

export class AihubReadinessLeaseModel {
  private db: LobeChatDatabase;
  private leaseTtlMs: number;

  constructor(db: LobeChatDatabase, leaseTtlMs = 60_000) {
    this.db = db;
    this.leaseTtlMs = leaseTtlMs;
  }

  acquire = async (userId: string, ownerId: string, now = new Date()) => {
    const expiresAt = new Date(now.getTime() + this.leaseTtlMs);
    const rows = await this.db
      .insert(aihubReadinessLeases)
      .values({ acquiredAt: now, expiresAt, ownerId, userId })
      .onConflictDoUpdate({
        set: { acquiredAt: now, expiresAt, ownerId },
        setWhere: lte(aihubReadinessLeases.expiresAt, now),
        target: aihubReadinessLeases.userId,
      })
      .returning();

    return rows[0];
  };

  release = async (userId: string, ownerId: string) => {
    return this.db
      .delete(aihubReadinessLeases)
      .where(
        and(eq(aihubReadinessLeases.userId, userId), eq(aihubReadinessLeases.ownerId, ownerId)),
      );
  };

  clearExpired = async (now = new Date()) => {
    return this.db.delete(aihubReadinessLeases).where(lte(aihubReadinessLeases.expiresAt, now));
  };
}
