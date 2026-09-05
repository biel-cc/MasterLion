import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, it, vi } from 'vitest';

import { validateConfig } from './config.mjs';
import { startProxy } from './proxy.mjs';

it('forwards package JSON module imports to Vite and leaves business requests on Next', async () => {
  const servers: http.Server[] = [];
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('MASTERINO_DEV_ENV', 'local');
  const upstream = async (name: string) => {
    const server = http.createServer((req, res) => res.end(`${name}:${req.url}`));
    servers.push(server);
    server.listen(0, 'localhost');
    await once(server, 'listening');
    return String((server.address() as AddressInfo).port);
  };
  try {
    const vitePort = await upstream('vite'),
      nextPort = await upstream('next');
    const config = {
      c: { ...validateConfig({}), WEB_PORT: '0', VITE_PORT: vitePort, NEXT_PORT: nextPort },
      origin: 'http://localhost:0',
      project: 'test',
      instance: {
        id: 'test',
        password: '',
        authSecret: '',
        vaultSecret: '',
        gatewayToken: '',
        jwks: '',
        publicJwks: '',
      },
    };
    const proxy = await startProxy(config);
    servers.push(proxy);
    const origin = `http://localhost:${(proxy.address() as AddressInfo).port}`;
    config.origin = origin;
    for (const [url, target] of [
      ['/package.json?import', 'vite'],
      ['/package.json', 'vite'],
      ['/packages/const/src/version.ts', 'vite'],
      ['/api/auth/get-session', 'next'],
      ['/package.json-other', 'next'],
    ]) {
      const result = await fetch(origin + url);
      expect(result.status).toBe(200);
      expect(await result.text()).toBe(`${target}:${url}`);
    }
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    vi.unstubAllEnvs();
  }
});

it('closes the upstream event stream when the browser disconnects', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('MASTERINO_DEV_ENV', 'local');
  let upstreamClosed = false;
  const next = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': connected\n\n');
    res.on('close', () => {
      upstreamClosed = true;
    });
  });
  next.listen(0, 'localhost');
  await once(next, 'listening');
  const config = {
    c: {
      ...validateConfig({}),
      WEB_PORT: '0',
      NEXT_PORT: String((next.address() as AddressInfo).port),
    },
    origin: 'http://localhost:0',
    project: 'test',
    instance: {
      id: 'test',
      password: '',
      authSecret: '',
      vaultSecret: '',
      gatewayToken: '',
      jwks: '',
      publicJwks: '',
    },
  };
  const proxy = await startProxy(config);
  config.origin = `http://localhost:${(proxy.address() as AddressInfo).port}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = http.get(config.origin + '/api/agent/events', (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
      });
      request.on('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(upstreamClosed).toBe(true);
  } finally {
    await Promise.all(
      [next, proxy].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
    vi.unstubAllEnvs();
  }
});
