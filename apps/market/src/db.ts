import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export const createPool = (connectionString: string) => new Pool({
  connectionString,
  max: 15,
  statement_timeout: 15_000,
});

export type MarketPool = InstanceType<typeof Pool>;

export const migrate = async (pool: MarketPool): Promise<void> => {
  const migrationDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  await pool.query(`CREATE TABLE IF NOT EXISTS market_schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = await pool.query('SELECT 1 FROM market_schema_migrations WHERE version = $1', [file]);
    if (exists.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await fs.readFile(path.join(migrationDir, file), 'utf8'));
      await client.query('INSERT INTO market_schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};
