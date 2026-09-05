import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

import { type LocalConfig, root, systemEnvironment } from './config.mjs';

export function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; capture?: boolean } = {},
) {
  const r = spawnSync(command, args, {
    cwd: root,
    env: options.env || systemEnvironment(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(
      `${command} ${args.slice(0, 2).join(' ')} failed (${r.status}). See service logs.`,
    );
  return r.stdout?.trim() || '';
}
export function compose(config: LocalConfig, args: string[], capture = false) {
  verifyLocalDocker();
  return run(
    'docker',
    [
      'compose',
      '--project-name',
      config.project,
      '--env-file',
      '/dev/null',
      '-f',
      path.join(root, 'docker-compose/local/compose.yml'),
      ...args,
    ],
    {
      capture,
      env: {
        ...systemEnvironment(),
        ...config.c,
        LOCAL_PASSWORD: config.instance.password,
        LOCAL_GATEWAY_TOKEN: config.instance.gatewayToken,
        LOCAL_GATEWAY_JWKS: config.instance.publicJwks,
      },
    },
  );
}
export function assertLocalDockerEndpoint(endpoint: string) {
  if (!endpoint.startsWith('unix://'))
    throw new Error(
      'Local development requires a local Docker Unix socket; remote Docker targets are rejected.',
    );
}
function verifyLocalDocker() {
  const env = systemEnvironment();
  // DOCKER_CONTEXT takes precedence over DOCKER_HOST in the Docker CLI.
  const endpoint =
    env.DOCKER_HOST && !env.DOCKER_CONTEXT
      ? env.DOCKER_HOST
      : run(
          'docker',
          [
            'context',
            'inspect',
            ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []),
            '--format',
            '{{.Endpoints.docker.Host}}',
          ],
          { capture: true },
        );
  assertLocalDockerEndpoint(endpoint);
}
export function verifyDatabaseOwner(config: LocalConfig) {
  const id = compose(config, ['ps', '-q', 'postgres'], true);
  if (!id) throw new Error('Owned PostgreSQL container is not running.');
  const info = JSON.parse(run('docker', ['inspect', id], { capture: true }))[0];
  const binding = info.NetworkSettings.Ports['5432/tcp'];
  if (
    info.Config.Labels['com.docker.compose.project'] !== config.project ||
    !info.State.Running ||
    !binding?.some(
      (b: { HostIp: string; HostPort: string }) =>
        b.HostIp === '127.0.0.1' && b.HostPort === config.c.POSTGRES_PORT,
    )
  )
    throw new Error(
      'Database ownership or published port does not match this local instance. Refusing migration.',
    );
}
export function workflowEnvironment(config: LocalConfig): NodeJS.ProcessEnv {
  const logs = compose(config, ['logs', '--no-log-prefix', 'qstash'], true);
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY']) {
    const value = [...logs.matchAll(new RegExp(`^${name}=(.+)$`, 'gm'))].at(-1)?.[1]?.trim();
    if (!value) throw new Error('Local QStash is not initialized; inspect its container logs.');
    env[name] = value;
  }
  return env;
}
export const portOpen = (port: number, host = 'localhost') =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, host);
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(700, () => done(false));
  });
export async function assertPortsFree(ports: string[]) {
  for (const port of ports)
    if ((await portOpen(+port)) || (await portOpen(+port, '127.0.0.1')))
      throw new Error(
        `Port ${port} is already used. Stop its owner explicitly or change .local-dev/config.env.`,
      );
}
export async function waitFor(url: string, timeout = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(Math.min(timeout, 60_000)) });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
