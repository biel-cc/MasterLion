import type { MarketPool } from './db.js';
import type { Account } from './repository.js';
import { decryptJson, encryptJson } from './crypto.js';

export class CredentialVault {
  constructor(private readonly pool: MarketPool, private readonly secret: string) {}

  private scope(account: Account, workspaceId?: string) { return [account.id, workspaceId || null] as const; }

  async create(input: Record<string, any>, account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `INSERT INTO market_credentials(account_id, workspace_id, key, name, description, type, encrypted_value, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(account_id, coalesce(workspace_id, ''), key) DO UPDATE SET
         name=excluded.name, description=excluded.description, type=excluded.type,
         encrypted_value=excluded.encrypted_value, metadata=excluded.metadata, updated_at=now()
       RETURNING *`,
      [accountId, scope, input.key, input.name || input.key, input.description || null, input.type,
        encryptJson(input.value ?? input.payload ?? input.data ?? input, this.secret), JSON.stringify(input.metadata || {})],
    );
    return this.mask(result.rows[0]);
  }

  async list(account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `SELECT * FROM market_credentials WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 ORDER BY updated_at DESC`,
      [accountId, scope],
    );
    return result.rows.map((row) => this.mask(row));
  }

  async get(id: string, account: Account, workspaceId: string | undefined, includeValue = false) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `SELECT * FROM market_credentials WHERE id=$1 AND account_id=$2 AND workspace_id IS NOT DISTINCT FROM $3`,
      [id, accountId, scope],
    );
    if (!result.rowCount) return null;
    const masked = this.mask(result.rows[0]);
    return includeValue ? { ...masked, plaintext: decryptJson(result.rows[0].encrypted_value, this.secret) } : masked;
  }

  async delete(id: string, account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `DELETE FROM market_credentials WHERE id=$1 AND account_id=$2 AND workspace_id IS NOT DISTINCT FROM $3 RETURNING id`,
      [id, accountId, scope],
    );
    return { success: Boolean(result.rowCount) };
  }

  async deleteByKey(key: string, account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `DELETE FROM market_credentials WHERE key=$1 AND account_id=$2 AND workspace_id IS NOT DISTINCT FROM $3 RETURNING id`,
      [key, accountId, scope],
    );
    return { success: Boolean(result.rowCount) };
  }

  async resolve(keys: string[], account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `SELECT * FROM market_credentials WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND key=ANY($3::text[])`,
      [accountId, scope, keys],
    );
    const credentials: Record<string, unknown> = {};
    for (const row of result.rows) credentials[row.key] = decryptJson(row.encrypted_value, this.secret);
    return { credentials, files: [], missingKeys: keys.filter((key) => !(key in credentials)), skippedHeaders: [] };
  }

  async inject(keys: string[], account: Account, workspaceId?: string) {
    const [accountId, scope] = this.scope(account, workspaceId);
    const result = await this.pool.query(
      `SELECT * FROM market_credentials WHERE account_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND key=ANY($3::text[])`,
      [accountId, scope, keys],
    );
    const env: Record<string, string> = {};
    const files: Array<{ filename: string; key: string; path: string }> = [];
    const found = new Set<string>();
    const unsupportedInSandbox: string[] = [];
    for (const row of result.rows) {
      found.add(row.key);
      const value = decryptJson(row.encrypted_value, this.secret) as Record<string, unknown>;
      if (row.type === 'kv-env' || row.type === 'oauth') {
        for (const [key, item] of Object.entries(value || {})) env[key] = String(item);
      } else if (row.type === 'file') {
        files.push({ filename: String(value?.fileName || row.key), key: row.key, path: String(value?.path || '') });
      } else {
        unsupportedInSandbox.push(row.key);
      }
    }
    const notFound = keys.filter((key) => !found.has(key));
    return {
      credentials: { env, files },
      notFound,
      success: notFound.length === 0,
      unsupportedInSandbox,
    };
  }

  private mask(row: Record<string, any>) {
    return {
      createdAt: row.created_at,
      description: row.description,
      id: Number(row.id),
      key: row.key,
      maskedValue: '••••••••',
      metadata: row.metadata || {},
      name: row.name,
      type: row.type,
      updatedAt: row.updated_at,
    };
  }
}
