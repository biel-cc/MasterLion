import { and, count, eq, sql } from 'drizzle-orm';

import { AihubReadinessLeaseModel } from '@/database/models/newApiBinding';
import {
  aiModels,
  aiProviders,
  enterpriseUserProfiles,
  externalIdentities,
  newApiBindings,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import type {
  AihubIamBindingState,
  AihubReadinessBindingStore,
  AihubReadinessErrorKind,
  AihubReadinessIdentitySource,
  AihubReadinessLease,
} from './index';

export class DatabaseAihubReadinessBindingStore implements AihubReadinessBindingStore {
  constructor(private readonly db: LobeChatDatabase) {}

  get = async (userId: string) => {
    return this.db.query.newApiBindings.findFirst({
      where: eq(newApiBindings.userId, userId),
    });
  };

  markPending: AihubReadinessBindingStore['markPending'] = async (userId) => {
    const now = new Date();
    await this.db
      .insert(newApiBindings)
      .values({
        attemptCount: 1,
        errorCode: null,
        errorKind: null,
        errorMessage: null,
        lastAttemptAt: now,
        nextRetryAt: null,
        status: 'pending',
        userId,
      })
      .onConflictDoUpdate({
        set: {
          attemptCount: sql`${newApiBindings.attemptCount} + 1`,
          errorCode: null,
          errorKind: null,
          errorMessage: null,
          lastAttemptAt: now,
          nextRetryAt: null,
          status: 'pending',
          updatedAt: now,
        },
        target: newApiBindings.userId,
      });
  };

  markActive: AihubReadinessBindingStore['markActive'] = async (userId, input) => {
    const now = new Date();
    await this.db
      .insert(newApiBindings)
      .values({
        attemptCount: 0,
        errorCode: null,
        errorKind: null,
        errorMessage: null,
        lastAttemptAt: now,
        lastSyncedAt: now,
        managedTokenId: input.managedTokenId,
        newApiUserId: input.newApiUserId,
        nextRetryAt: null,
        readinessVersion: input.readinessVersion,
        status: 'active',
        userId,
      })
      .onConflictDoUpdate({
        set: {
          attemptCount: 0,
          errorCode: null,
          errorKind: null,
          errorMessage: null,
          lastSyncedAt: now,
          managedTokenId: input.managedTokenId,
          newApiUserId: input.newApiUserId,
          nextRetryAt: null,
          readinessVersion: input.readinessVersion,
          status: 'active',
          updatedAt: now,
        },
        target: newApiBindings.userId,
      });
  };

  markError: AihubReadinessBindingStore['markError'] = async (userId, input) => {
    const now = new Date();
    await this.db
      .insert(newApiBindings)
      .values({
        attemptCount: 1,
        errorCode: input.errorCode,
        errorKind: input.errorKind,
        errorMessage: input.errorMessage,
        lastAttemptAt: now,
        nextRetryAt: input.nextRetryAt ?? null,
        status: 'error',
        userId,
      })
      .onConflictDoUpdate({
        set: {
          errorCode: input.errorCode,
          errorKind: input.errorKind,
          errorMessage: input.errorMessage,
          nextRetryAt: input.nextRetryAt ?? null,
          status: 'error',
          updatedAt: now,
        },
        target: newApiBindings.userId,
      });
  };

  updateIamBinding = async (userId: string, state: AihubIamBindingState) => {
    const now = new Date();
    await this.db
      .update(newApiBindings)
      .set({
        iamOAuthBindingError: state.errorMessage ?? null,
        iamOAuthBindingErrorCode: state.errorCode ?? null,
        iamOAuthBindingStatus: state.status,
        iamOAuthBindingSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(newApiBindings.userId, userId));
  };
}

export class DatabaseAihubReadinessIdentitySource implements AihubReadinessIdentitySource {
  constructor(private readonly db: LobeChatDatabase) {}

  getEnterpriseIdentity = async (userId: string) => {
    const [user, profile, identity] = await Promise.all([
      this.db.query.users.findFirst({ where: eq(users.id, userId) }),
      this.db.query.enterpriseUserProfiles.findFirst({
        where: and(
          eq(enterpriseUserProfiles.userId, userId),
          eq(enterpriseUserProfiles.provider, 'wecom'),
        ),
      }),
      this.db.query.externalIdentities.findFirst({
        where: and(eq(externalIdentities.userId, userId), eq(externalIdentities.provider, 'wecom')),
      }),
    ]);

    if (!user || !profile || !identity) return undefined;

    return {
      email: user.email ?? undefined,
      employeeNumber: profile.employeeNumber ?? undefined,
      employmentStatus: profile.employmentStatus,
      masterinoUsername: user.username ?? undefined,
      name: user.fullName ?? user.firstName ?? undefined,
    };
  };
}

export class DatabaseAihubReadinessLease implements AihubReadinessLease {
  private readonly model: AihubReadinessLeaseModel;

  constructor(db: LobeChatDatabase, ttlMs = 60_000) {
    this.model = new AihubReadinessLeaseModel(db, ttlMs);
  }

  acquire: AihubReadinessLease['acquire'] = async (userId, requestedOwnerId) => {
    return this.model.acquire(userId, requestedOwnerId);
  };

  release: AihubReadinessLease['release'] = async (userId, ownerId) => {
    await this.model.release(userId, ownerId);
  };
}

type KeyVaultDecryptor = Pick<KeyVaultsGateKeeper, 'decrypt'>;

const hasUsableApiKey = async (
  encryptedKeyVaults: string | null | undefined,
  gateKeeper?: KeyVaultDecryptor,
) => {
  if (!encryptedKeyVaults) return false;

  try {
    const decryptor = gateKeeper ?? (await KeyVaultsGateKeeper.initWithEnvKey());
    const decrypted = await decryptor.decrypt(encryptedKeyVaults);
    if (!decrypted.wasAuthentic || !decrypted.plaintext) return false;

    const keyVaults = JSON.parse(decrypted.plaintext) as { apiKey?: unknown };
    return typeof keyVaults.apiKey === 'string' && keyVaults.apiKey.trim().length > 0;
  } catch {
    return false;
  }
};

export const inspectAihubLocalRuntime = async (
  db: LobeChatDatabase,
  userId: string,
  gateKeeper?: KeyVaultDecryptor,
) => {
  const [provider, modelRows] = await Promise.all([
    db.query.aiProviders.findFirst({
      where: and(eq(aiProviders.id, 'newapi'), eq(aiProviders.userId, userId)),
    }),
    db
      .select({ count: count() })
      .from(aiModels)
      .where(
        and(
          eq(aiModels.providerId, 'newapi'),
          eq(aiModels.userId, userId),
          eq(aiModels.enabled, true),
        ),
      ),
  ]);

  return {
    hasApiKey:
      Boolean(provider?.enabled) && (await hasUsableApiKey(provider?.keyVaults, gateKeeper)),
    modelCount: Number(modelRows[0]?.count ?? 0),
  };
};

export const asAihubReadinessErrorKind = (value: unknown): AihubReadinessErrorKind | undefined =>
  value === 'configuration' ||
  value === 'transient' ||
  value === 'identity_conflict' ||
  value === 'entitlement' ||
  value === 'permanent'
    ? value
    : undefined;
