import { Hono } from 'hono';
import { fetch as proxyFetch, ProxyAgent } from 'undici';

import { ConnectorRunSchema } from './contracts.js';
import { createPool } from './db.js';
import { assertPublicHostname } from './networkSecurity.js';
import { serveHono } from './server.js';

const databaseUrl = process.env.MARKET_DATABASE_URL;
const internalToken = process.env.MARKET_RUNNER_INTERNAL_TOKEN;
const proxyUrl = process.env.CONNECTOR_EGRESS_PROXY_URL;
if (!databaseUrl || !internalToken || !proxyUrl) throw new Error('Runner requires database, internal token and CONNECTOR_EGRESS_PROXY_URL');
const pool = createPool(databaseUrl);
const proxyAgent = new ProxyAgent(proxyUrl);
const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.post('/internal/run', async (c) => {
  if (c.req.header('x-market-runner-token') !== internalToken) return c.json({ error: 'unauthorized' }, 401);
  const input = ConnectorRunSchema.parse(await c.req.json());
  const target = new URL(input.url);
  if (target.username || target.password) return c.json({ error: 'url_credentials_forbidden' }, 403);
  const port = target.port ? Number(target.port) : target.protocol === 'https:' ? 443 : 80;
  const allowed = await pool.query(
    `SELECT allow_private FROM market_connector_allowlist
     WHERE provider=$1 AND protocol=$2 AND lower(hostname)=lower($3)
       AND (port IS NULL OR port=$4) AND enabled=true`,
    [input.provider, target.protocol, target.hostname, port],
  );
  if (!allowed.rowCount) return c.json({ error: 'connector_target_not_allowlisted' }, 403);
  if (!allowed.rows[0].allow_private) {
    try {
      await assertPublicHostname(target.hostname);
    } catch {
      return c.json({ error: 'ssrf_target_rejected' }, 403);
    }
  } else if (target.hostname === 'localhost' || target.hostname.endsWith('.localhost')) {
    return c.json({ error: 'ssrf_target_rejected' }, 403);
  }
  const forbiddenHeaders = new Set(['connection', 'content-length', 'host', 'proxy-authorization', 'transfer-encoding', 'upgrade']);
  if (Object.keys(input.headers || {}).some((header) => forbiddenHeaders.has(header.toLowerCase()))) {
    return c.json({ error: 'forbidden_connector_header' }, 403);
  }
  const response = await proxyFetch(target, {
    body: input.body === undefined ? undefined : input.bodyEncoding === 'form'
      ? new URLSearchParams(input.body as Record<string, string>).toString()
      : JSON.stringify(input.body),
    headers: { 'content-type': 'application/json', ...input.headers },
    method: input.method,
    dispatcher: proxyAgent,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return c.json({ data: body, status: response.status, success: response.ok }, response.ok ? 200 : 502);
});

serveHono(app.fetch, Number(process.env.MARKET_RUNNER_PORT || 3221));
console.log('Masterino Connector Runner listening on 3221');
