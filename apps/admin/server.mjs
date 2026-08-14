import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const setHeaders = (response, headers = {}) => {
  for (const [name, value] of Object.entries({ ...securityHeaders, ...headers })) {
    response.setHeader(name, value);
  }
};

const resolveAsset = async (rootDirectory, pathname) => {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return;
  }

  const relativePath = decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(rootDirectory, relativePath || 'index.html');
  const relativeCandidate = path.relative(rootDirectory, candidate);
  if (relativeCandidate.startsWith('..') || path.isAbsolute(relativeCandidate)) return;

  try {
    const fileStats = await stat(candidate);
    if (fileStats.isFile()) return candidate;
  } catch {
    return;
  }
};

const sendFile = async (request, response, filePath, cacheControl) => {
  const fileStats = await stat(filePath);
  setHeaders(response, {
    'Cache-Control': cacheControl,
    'Content-Length': fileStats.size,
    'Content-Type':
      contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
  });
  response.statusCode = 200;
  if (request.method === 'HEAD') return response.end();
  createReadStream(filePath).pipe(response);
};

export const createAdminRequestHandler = (rootDirectory) => async (request, response) => {
  const method = request.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    setHeaders(response, { 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' });
    response.statusCode = 405;
    return response.end('Method Not Allowed');
  }

  const requestUrl = new URL(request.url || '/', 'http://localhost');
  if (requestUrl.pathname === '/healthz') {
    setHeaders(response, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.statusCode = 200;
    return response.end(method === 'HEAD' ? undefined : 'ok');
  }

  const asset = await resolveAsset(rootDirectory, requestUrl.pathname);
  if (asset) {
    const immutable = requestUrl.pathname.startsWith('/assets/');
    return sendFile(
      request,
      response,
      asset,
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  }

  return sendFile(request, response, path.join(rootDirectory, 'index.html'), 'no-store');
};

export const createAdminServer = ({ rootDirectory, host = '0.0.0.0', port = 3020 }) => {
  const server = createServer(createAdminRequestHandler(path.resolve(rootDirectory)));
  return { host, port, server };
};

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const rootDirectory = fileURLToPath(new URL('./dist', import.meta.url));
  const host = process.env.ADMIN_HOST || '0.0.0.0';
  const port = Number.parseInt(process.env.ADMIN_PORT || '3020', 10);
  const { server } = createAdminServer({ host, port, rootDirectory });
  server.listen(port, host, () => {
    console.info(`Masterino Admin listening on http://${host}:${port}`);
  });
}
