import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';

import type { LocalConfig } from './config.mjs';

export const developmentEmail = 'developer@masterino.local';
export function localReturnPath(value: string | null, origin: string) {
  try {
    const url = new URL(value || '/', origin);
    if (
      url.origin === origin &&
      !url.pathname.startsWith('/signin') &&
      !url.pathname.startsWith('/__local-dev')
    )
      return `${url.pathname}${url.search}${url.hash}`;
  } catch {}
  return '/';
}
export function validLocalRequest(
  host: string | undefined,
  origin: string | undefined,
  expected: string,
) {
  return host === new URL(expected).host && (origin === undefined || origin === expected);
}
export function createGrantStore() {
  const grants = new Map<string, number>();
  return {
    issue() {
      const now = Date.now();
      for (const [key, expiry] of grants) if (expiry < now) grants.delete(key);
      const token = randomBytes(32).toString('hex');
      grants.set(token, now + 60_000);
      return token;
    },
    consume(token: string) {
      const expiry = grants.get(token);
      grants.delete(token);
      return !!expiry && expiry > Date.now();
    },
  };
}
export async function authRequest(config: LocalConfig, action: 'sign-up/email' | 'sign-in/email') {
  return fetch(`http://localhost:${config.c.NEXT_PORT}/api/auth/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': config.origin,
      'Host': new URL(config.origin).host,
    },
    body: JSON.stringify({
      email: developmentEmail,
      password: config.instance.password,
      name: '本地开发者',
    }),
    signal: AbortSignal.timeout(120_000),
  });
}
function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, port: number) {
  const upstream = http.request(
    { hostname: 'localhost', port, method: req.method, path: req.url, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Local backend is not ready. See pnpm dev:local:doctor.');
  });
  req.on('aborted', () => upstream.destroy());
  // A GET request body is already complete when its SSE response is cancelled.
  // Listen to the downstream response too, or the upstream subscription leaks.
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}
function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, port: number) {
  const upstream = net.connect(port, 'localhost', () => {
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        req.rawHeaders.reduce((s, h, i) => s + (i % 2 ? `${h}\r\n` : `${h}: `), '') +
        '\r\n',
    );
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
}
export async function startProxy(config: LocalConfig, onStop: () => void = () => {}) {
  if (process.env.NODE_ENV !== 'development' || process.env.MASTERINO_DEV_ENV !== 'local')
    throw new Error('Development proxy may only run in explicit local development mode.');
  const grants = createGrantStore();
  const server = http.createServer(async (req, res) => {
    try {
      if (!validLocalRequest(req.headers.host, undefined, config.origin)) {
        res.writeHead(403);
        res.end('Invalid local host');
        return;
      }
      const pathname = new URL(req.url || '/', config.origin).pathname;
      // Preserve the normal desktop OIDC flow after establishing a local session.
      // This route exists only in the dev proxy; deployed sign-in is unchanged.
      if (pathname === '/signin' && req.method === 'GET') {
        const callback = new URL(req.url!, config.origin).searchParams.get('callbackUrl');
        res.writeHead(302, {
          'Location': `/__local-dev?returnTo=${encodeURIComponent(localReturnPath(callback, config.origin))}`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
      if (pathname.startsWith('/__local-dev')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        if (
          req.headers['sec-fetch-site'] === 'cross-site' ||
          !validLocalRequest(req.headers.host, req.headers.origin, config.origin)
        ) {
          res.writeHead(403);
          res.end('Local origin required');
          return;
        }
        if (pathname === '/__local-dev/stop' && req.method === 'POST') {
          const owner = req.headers['x-masterino-owner'];
          if (
            typeof owner !== 'string' ||
            owner.length !== config.instance.gatewayToken.length ||
            !timingSafeEqual(Buffer.from(owner), Buffer.from(config.instance.gatewayToken))
          ) {
            res.writeHead(403);
            res.end();
            return;
          }
          res.end('stopping');
          setTimeout(onStop, 50);
          return;
        }
        if (pathname === '/__local-dev/status' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              environment: 'local',
              instance: config.instance.id,
              backend: `http://localhost:${config.c.NEXT_PORT}`,
              gateway: `http://localhost:${config.c.GATEWAY_PORT}`,
            }),
          );
          return;
        }
        if (pathname === '/__local-dev/login' && req.method === 'POST') {
          const token = req.headers['x-masterino-dev-grant'];
          if (
            req.headers.origin !== config.origin ||
            typeof token !== 'string' ||
            !grants.consume(token)
          ) {
            res.writeHead(403);
            res.end('Expired or invalid local login grant');
            return;
          }
          const result = await authRequest(config, 'sign-in/email');
          if (!result.ok) {
            res.writeHead(503);
            res.end('Development account is not initialized. Check local startup logs.');
            return;
          }
          const cookies = result.headers.getSetCookie();
          if (!cookies.length) throw new Error('Better Auth did not issue a session cookie.');
          res.setHeader('Set-Cookie', cookies);
          res.end('ok');
          return;
        }
        if (pathname === '/__local-dev' && req.method === 'GET') {
          const token = grants.issue();
          const target = localReturnPath(
            new URL(req.url!, config.origin).searchParams.get('returnTo'),
            config.origin,
          );
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Masterino 本地开发</title><body><p id="status">正在进入本地开发环境…</p><script>fetch('/__local-dev/login',{method:'POST',headers:{'x-masterino-dev-grant':${JSON.stringify(token)}}}).then(async r=>{if(!r.ok)throw new Error(await r.text());location.replace(${JSON.stringify(target).replaceAll('<', '\\u003c')})}).catch(e=>document.getElementById('status').textContent=e.message)</script></body></html>`,
          );
          return;
        }
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Not configured in isolated local development',
            code: 'LOCAL_CAPABILITY_UNAVAILABLE',
          }),
        );
        return;
      }
      const vite =
        pathname === '/package.json' ||
        /^\/(?:@vite\/|@id\/|@fs\/|@react-refresh|src\/|node_modules\/|packages\/|apps\/|locales\/)/.test(
          pathname,
        );
      proxyHttp(req, res, +(vite ? config.c.VITE_PORT : config.c.NEXT_PORT));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('Local development request failed.');
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!validLocalRequest(req.headers.host, undefined, config.origin)) {
      socket.destroy();
      return;
    }
    const vite = String(req.headers['sec-websocket-protocol']).includes('vite-hmr');
    proxyUpgrade(req, socket, head, +(vite ? config.c.VITE_PORT : config.c.NEXT_PORT));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(+config.c.WEB_PORT, 'localhost', resolve);
  });
  return server;
}
