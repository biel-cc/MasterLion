import { createDecipheriv, createHash } from 'node:crypto';
import type { Context, Next } from 'hono';

import { TrustedClientPayloadSchema, type TrustedClientPayload } from './contracts.js';

const PREFIX = 'lobehub-market_tcs_';
const MAX_TOKEN_AGE_MS = 5 * 60 * 1000;

const deriveKey = (secret: string): Buffer => {
  if (secret.startsWith(PREFIX)) return createHash('sha256').update(secret).digest();
  const key = Buffer.from(secret, 'hex');
  if (key.length !== 32) throw new Error('MARKET_TRUSTED_CLIENT_SECRET must be 32-byte hex or a prefixed secret');
  return key;
};

export const decryptTrustedClientToken = (token: string, secret: string): TrustedClientPayload => {
  if (!/^[A-Za-z\d+/]+={0,2}$/.test(token) || token.length % 4 !== 0) throw new Error('Malformed trusted client token');
  const value = Buffer.from(token, 'base64');
  if (value.toString('base64') !== token) throw new Error('Non-canonical trusted client token');
  if (value.length < 29) throw new Error('Malformed trusted client token');
  const iv = value.subarray(0, 12);
  const ciphertext = value.subarray(12, -16);
  const tag = value.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const payload = TrustedClientPayloadSchema.parse(JSON.parse(json));
  if (Math.abs(Date.now() - payload.timestamp) > MAX_TOKEN_AGE_MS) throw new Error('Trusted client token expired');
  return payload;
};

export interface AuthEnv {
  Variables: {
    actor: TrustedClientPayload;
    role: 'submitter' | 'reviewer' | 'admin';
  };
}

export const trustedClientAuth = (options: {
  adminIds: Set<string>;
  clientIds: Set<string>;
  secret: string;
}) => async (c: Context<AuthEnv>, next: Next) => {
  const token = c.req.header('x-lobe-trust-token');
  if (!token) return c.json({ error: 'trusted_client_token_required' }, 401);
  try {
    const actor = decryptTrustedClientToken(token, options.secret);
    if (!options.clientIds.has(actor.clientId)) return c.json({ error: 'trusted_client_not_allowed' }, 401);
    c.set('actor', actor);
    c.set('role', options.adminIds.has(actor.userId) ? 'admin' : 'submitter');
    await next();
  } catch {
    return c.json({ error: 'invalid_trusted_client_token' }, 401);
  }
};

export const requireRole = (...roles: Array<'submitter' | 'reviewer' | 'admin'>) =>
  async (c: Context<AuthEnv>, next: Next) => {
    if (!roles.includes(c.get('role'))) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
