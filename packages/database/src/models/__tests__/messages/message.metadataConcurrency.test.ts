import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

type Metadata = Record<string, unknown>;

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

class TestMutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  acquire = async (): Promise<() => void> => {
    if (this.locked) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.locked = true;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.locked = false;
    };
  };
}

const createMetadataConcurrencyHarness = (initialMetadata: Metadata) => {
  const lock = new TestMutex();
  const readRequested = createDeferred();
  let metadata = structuredClone(initialMetadata);

  const createDatabaseScope = (transactional: boolean) => {
    let releaseTransactionLock: (() => void) | undefined;

    const acquireMessageLock = async () => {
      if (releaseTransactionLock) return;
      releaseTransactionLock = await lock.acquire();
    };

    const readMetadata = async (forUpdate: boolean) => {
      readRequested.resolve();
      if (forUpdate) await acquireMessageLock();

      return [{ metadata: structuredClone(metadata) }];
    };

    const select = () => {
      let forUpdate = false;
      const task = Promise.resolve().then(() => readMetadata(forUpdate));
      const builder = Object.assign(task, {
        for: () => {
          forUpdate = true;
          return builder;
        },
        from: () => builder,
        where: () => builder,
      });

      return builder;
    };

    const update = () => {
      let values: { metadata?: Metadata } = {};
      const execute = async () => {
        await acquireMessageLock();
        if (values.metadata) metadata = structuredClone(values.metadata);
        if (!transactional) {
          releaseTransactionLock?.();
          releaseTransactionLock = undefined;
        }

        return [{ topicId: null }];
      };
      const task = Promise.resolve().then(execute);
      const builder = Object.assign(task, {
        returning: () => task,
        set: (nextValues: { metadata?: Metadata }) => {
          values = nextValues;
          return builder;
        },
        where: () => builder,
      });

      return builder;
    };

    const scope = {
      query: {
        messages: {
          findFirst: async () => {
            const [message] = await readMetadata(false);
            return message;
          },
        },
      },
      select,
      update,
    };

    return {
      release: () => releaseTransactionLock?.(),
      scope,
    };
  };

  const rootScope = createDatabaseScope(false);
  const database = {
    ...rootScope.scope,
    transaction: async <T>(callback: (trx: unknown) => Promise<T>): Promise<T> => {
      const transactionScope = createDatabaseScope(true);
      try {
        return await callback(transactionScope.scope);
      } finally {
        transactionScope.release();
      }
    },
  } as unknown as LobeChatDatabase;

  return {
    beginServerLifecycleWrite: async (toolLifecycle: Metadata) => {
      const release = await lock.acquire();
      return () => {
        metadata = { ...metadata, toolLifecycle: structuredClone(toolLifecycle) };
        release();
      };
    },
    database,
    getMetadata: () => structuredClone(metadata),
    readRequested: readRequested.promise,
  };
};

describe('MessageModel metadata concurrency', () => {
  it('update preserves a lifecycle marker committed after its metadata read began', async () => {
    const harness = createMetadataConcurrencyHarness({ existing: true });
    const messageModel = new MessageModel(harness.database, 'user-1');
    const lifecycle = {
      executionAttemptId: 'attempt-1',
      intentFingerprint: 'intent-1',
      resultFingerprint: 'result-1',
      resultProjectionFingerprint: 'projection-1',
    };
    const finishServerWrite = await harness.beginServerLifecycleWrite(lifecycle);

    const update = messageModel.update('message-1', { metadata: { activeBranchIndex: 1 } });
    await harness.readRequested;
    await nextTurn();
    finishServerWrite();
    await update;

    expect(harness.getMetadata()).toEqual({
      activeBranchIndex: 1,
      existing: true,
      toolLifecycle: lifecycle,
    });
  });

  it('updateMetadata preserves a lifecycle marker committed after its metadata read began', async () => {
    const harness = createMetadataConcurrencyHarness({ existing: true });
    const messageModel = new MessageModel(harness.database, 'user-1');
    const lifecycle = {
      executionAttemptId: 'attempt-1',
      intentFingerprint: 'intent-1',
      resultFingerprint: 'result-1',
      resultProjectionFingerprint: 'projection-1',
    };
    const finishServerWrite = await harness.beginServerLifecycleWrite(lifecycle);

    const update = messageModel.updateMetadata('message-1', { caller: true });
    await harness.readRequested;
    await nextTurn();
    finishServerWrite();
    await update;

    expect(harness.getMetadata()).toEqual({
      caller: true,
      existing: true,
      toolLifecycle: lifecycle,
    });
  });

  it('updateToolMessage preserves a lifecycle marker committed after its metadata read began', async () => {
    const harness = createMetadataConcurrencyHarness({ existing: true });
    const messageModel = new MessageModel(harness.database, 'user-1');
    const lifecycle = {
      executionAttemptId: 'attempt-1',
      intentFingerprint: 'intent-1',
      resultFingerprint: 'result-1',
      resultProjectionFingerprint: 'projection-1',
    };
    const finishServerWrite = await harness.beginServerLifecycleWrite(lifecycle);

    const update = messageModel.updateToolMessage('message-1', { metadata: { caller: true } });
    await harness.readRequested;
    await nextTurn();
    finishServerWrite();
    await update;

    expect(harness.getMetadata()).toEqual({
      caller: true,
      existing: true,
      toolLifecycle: lifecycle,
    });
  });
});
