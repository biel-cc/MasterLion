// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AihubReadinessLeaseModel, NewApiBindingModel } from '../newApiBinding';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'new-api-binding-user-id';
const otherUserId = 'new-api-binding-other-user-id';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

describe('NewApiBindingModel', () => {
  it('upserts a binding for the current user and can read it back', async () => {
    const model = new NewApiBindingModel(serverDB, userId);

    await model.upsert({
      encryptedAccessToken: 'encrypted-access-token',
      managedTokenId: 17,
      newApiUserId: 42,
      status: 'active',
    });

    const binding = await model.find();

    expect(binding).toMatchObject({
      encryptedAccessToken: 'encrypted-access-token',
      managedTokenId: 17,
      newApiUserId: 42,
      status: 'active',
      userId,
    });
  });

  it('updates status and sync metadata without touching another user', async () => {
    const model = new NewApiBindingModel(serverDB, userId);
    const otherModel = new NewApiBindingModel(serverDB, otherUserId);

    await model.upsert({
      encryptedAccessToken: 'encrypted-access-token',
      newApiUserId: 42,
      status: 'pending',
    });
    await otherModel.upsert({
      encryptedAccessToken: 'other-encrypted-access-token',
      newApiUserId: 43,
      status: 'active',
    });

    const lastSyncedAt = new Date('2026-06-18T08:00:00.000Z');
    await model.updateSyncState({
      errorMessage: 'token expired',
      lastSyncedAt,
      managedTokenId: 21,
      status: 'error',
    });

    const current = await model.find();
    const other = await otherModel.find();

    expect(current).toMatchObject({
      errorMessage: 'token expired',
      lastSyncedAt,
      managedTokenId: 21,
      status: 'error',
      userId,
    });
    expect(other).toMatchObject({
      encryptedAccessToken: 'other-encrypted-access-token',
      managedTokenId: null,
      status: 'active',
      userId: otherUserId,
    });
  });

  it('updates remote readiness ids without clearing a historical encrypted access token', async () => {
    const model = new NewApiBindingModel(serverDB, userId);
    await model.upsert({
      encryptedAccessToken: 'historical-encrypted-token',
      managedTokenId: 17,
      newApiUserId: 42,
      status: 'active',
    });

    await model.upsertRemoteIdentifiers({ managedTokenId: 21, newApiUserId: 43 });

    await expect(model.find()).resolves.toMatchObject({
      encryptedAccessToken: 'historical-encrypted-token',
      managedTokenId: 21,
      newApiUserId: 43,
      status: 'pending',
    });
  });

  it('allows an error binding without a real Aihub user id', async () => {
    const model = new NewApiBindingModel(serverDB, userId);

    await model.upsert({
      errorMessage: 'AIHub provisioning failed',
      newApiUserId: null,
      status: 'error',
    });

    const binding = await model.find();

    expect(binding).toMatchObject({
      errorMessage: 'AIHub provisioning failed',
      newApiUserId: null,
      status: 'error',
      userId,
    });
  });

  it('rejects a non-error binding without a real Aihub user id', async () => {
    const model = new NewApiBindingModel(serverDB, userId);

    await expect(
      model.upsert({
        newApiUserId: null,
        status: 'active',
      } as any),
    ).rejects.toThrow('newApiUserId is required for non-error NewAPI bindings');

    await expect(
      model.upsert({
        newApiUserId: 0,
        status: 'active',
      } as any),
    ).rejects.toThrow('newApiUserId is required for non-error NewAPI bindings');
  });

  it('deletes bindings when the owning user is deleted', async () => {
    const model = new NewApiBindingModel(serverDB, userId);

    await model.upsert({
      encryptedAccessToken: 'encrypted-access-token',
      newApiUserId: 42,
      status: 'active',
    });

    await serverDB.delete(users).where(eq(users.id, userId));

    const bindings = await serverDB.query.newApiBindings.findMany();
    expect(bindings).toHaveLength(0);
  });
});

describe('AihubReadinessLeaseModel', () => {
  it('allows only one active owner and permits takeover after expiry', async () => {
    const model = new AihubReadinessLeaseModel(serverDB, 60_000);
    const now = new Date('2026-08-31T01:00:00.000Z');

    const first = await model.acquire(userId, 'owner-a', now);
    const blocked = await model.acquire(userId, 'owner-b', new Date(now.getTime() + 1000));
    const takeover = await model.acquire(userId, 'owner-b', new Date(now.getTime() + 60_001));

    expect(first).toMatchObject({ ownerId: 'owner-a', userId });
    expect(blocked).toBeUndefined();
    expect(takeover).toMatchObject({ ownerId: 'owner-b', userId });
  });

  it('only lets the current owner release its lease', async () => {
    const model = new AihubReadinessLeaseModel(serverDB, 60_000);
    const now = new Date('2026-08-31T01:00:00.000Z');

    await model.acquire(userId, 'owner-a', now);
    await model.release(userId, 'owner-b');
    expect(await model.acquire(userId, 'owner-c', new Date(now.getTime() + 1000))).toBeUndefined();

    await model.release(userId, 'owner-a');
    await expect(
      model.acquire(userId, 'owner-c', new Date(now.getTime() + 2000)),
    ).resolves.toMatchObject({ ownerId: 'owner-c' });
  });
});
