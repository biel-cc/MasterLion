// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminServer } from './server.mjs';

let baseUrl;
let rootDirectory;
let server;

beforeAll(async () => {
  rootDirectory = await mkdtemp(path.join(tmpdir(), 'masterino-admin-server-'));
  await mkdir(path.join(rootDirectory, 'assets'));
  await writeFile(path.join(rootDirectory, 'index.html'), '<h1>Masterino Admin</h1>');
  await writeFile(path.join(rootDirectory, 'assets', 'app.js'), 'console.log("admin")');

  ({ server } = createAdminServer({ rootDirectory }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(rootDirectory, { force: true, recursive: true });
});

describe('Masterino Admin static server', () => {
  it('serves a no-store health check', async () => {
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('ok');
  });

  it('falls back to the SPA entry for nested routes', async () => {
    const response = await fetch(`${baseUrl}/users`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('Masterino Admin');
  });

  it('caches hashed assets and emits security headers', async () => {
    const response = await fetch(`${baseUrl}/assets/app.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
});
