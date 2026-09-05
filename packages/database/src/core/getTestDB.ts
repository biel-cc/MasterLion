import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { Pool as NodePool } from 'pg';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';

const migrationsFolder = path.join(__dirname, '../../migrations');

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

type ClientTestDB = ReturnType<typeof pgliteDrizzle<typeof schema>>;
type ServerTestDB = ReturnType<typeof nodeDrizzle<typeof schema>>;

let testClientDBInitialization: Promise<ClientTestDB> | null = null;
let testServerDBInitialization: Promise<ServerTestDB> | null = null;

const initializeServerDB = async (): Promise<ServerTestDB> => {
  const connectionString = serverDBEnv.DATABASE_TEST_URL;

  if (!connectionString) throw new Error('DATABASE_TEST_URL is not set');

  const client = new NodePool({ connectionString });
  const db = nodeDrizzle(client, { schema });
  try {
    await nodeMigrate(db, { migrationsFolder });
    return db;
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
};

const initializeClientDB = async (): Promise<ClientTestDB> => {
  const pglite = new PGlite({ extensions: { vector } });
  const db = pgliteDrizzle({ client: pglite, schema });

  try {
    // Apply compatible statements individually so pg_search migrations do not hide
    // unrelated schema changes. PGlite tests do not rely on production HNSW indexes,
    // whose extension behavior is covered by deployment migration checks instead.
    const migrations = readMigrationFiles({ migrationsFolder });

    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    for (const migration of migrations) {
      for (const stmt of migration.sql) {
        const normalizedStatement = stmt.toLowerCase();
        const isUnsupportedStatement =
          normalizedStatement.includes('pg_search') ||
          normalizedStatement.includes('bm25') ||
          normalizedStatement.includes('using hnsw');

        if (!isUnsupportedStatement) await db.execute(sql.raw(stmt));
      }

      await db.execute(
        sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
      );
    }

    return db;
  } catch (error) {
    await pglite.close().catch(() => undefined);
    throw error;
  }
};

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (!testServerDBInitialization) {
      const initialization = initializeServerDB();
      testServerDBInitialization = initialization;
      void initialization.catch(() => {
        if (testServerDBInitialization === initialization) testServerDBInitialization = null;
      });
    }

    return (await testServerDBInitialization) as unknown as LobeChatDatabase;
  }

  // Client DB mode (PGlite)
  if (!testClientDBInitialization) {
    const initialization = initializeClientDB();
    testClientDBInitialization = initialization;
    void initialization.catch(() => {
      if (testClientDBInitialization === initialization) testClientDBInitialization = null;
    });
  }

  return (await testClientDBInitialization) as unknown as LobeChatDatabase;
};

/**
 * Close and forget the cached test database so a later isolated runtime cannot
 * receive a previously closed client. Null the cache before awaiting I/O: even
 * a close failure must not make the dead handle reusable.
 */
export const closeTestDB = async (): Promise<void> => {
  const clientInitialization = testClientDBInitialization;
  const serverInitialization = testServerDBInitialization;
  testClientDBInitialization = null;
  testServerDBInitialization = null;

  const initialized = await Promise.allSettled(
    [clientInitialization, serverInitialization].filter(Boolean) as Array<
      Promise<ClientTestDB | ServerTestDB>
    >,
  );

  const clients = initialized
    .filter(
      (result): result is PromiseFulfilledResult<ClientTestDB | ServerTestDB> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value.$client) as Array<{
    close?: () => Promise<void>;
    end?: () => Promise<void>;
  }>;

  const results = await Promise.allSettled(
    clients.map((client) => (client.close ? client.close() : client.end?.())),
  );
  const failure = [...initialized, ...results].find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
};
