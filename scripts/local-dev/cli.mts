import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  configFile,
  initialize,
  loadConfig,
  localEnvironment,
  root,
  stateDir,
  systemEnvironment,
} from './config.mjs';
import { migrateLocal, seedLocal } from './database.mjs';
import {
  assertPortsFree,
  compose,
  run,
  verifyDatabaseOwner,
  waitFor,
  workflowEnvironment,
} from './infrastructure.mjs';
import { authRequest, startProxy } from './proxy.mjs';

const command = process.argv[2] || 'help';
const children: ChildProcess[] = [];
let closing = false;
function stopChildren() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
function launch(
  name: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = root,
) {
  const fd = openSync(path.join(stateDir, 'logs', `${name}.log`), 'a', 0o600);
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', fd, fd],
    detached: process.platform !== 'win32',
  });
  closeSync(fd);
  children.push(child);
  child.on('error', (e) => console.error(`${name}: ${e.message}`));
  child.on('exit', (code) => {
    if (!closing) {
      console.error(`${name} exited (${code}). See .local-dev/logs/${name}.log`);
      stopChildren();
      setTimeout(() => process.exit(1), 500).unref();
    }
  });
  return child;
}
const node = process.execPath;
async function main() {
  if (command === 'init') {
    initialize();
    console.log(`Created ${configFile}. Configure a dedicated Aihub API key here.`);
    return;
  }
  if (command === 'desktop-test') {
    initialize();
    const env: NodeJS.ProcessEnv = {
      ...systemEnvironment(),
      NODE_ENV: 'development',
      MASTERINO_DEV_ENV: 'test',
      MASTERINO_DESKTOP_PROFILE: 'test-server',
      OFFICIAL_CLOUD_SERVER: 'https://mlai-test.bielcrystal.com',
      NEXT_PUBLIC_DESKTOP_CLOUD_SERVER: 'https://mlai-test.bielcrystal.com',
      NEXT_PUBLIC_MARKET_BASE_URL: 'https://mlai-test.bielcrystal.com/market',
      DEVICE_GATEWAY_URL: 'https://mlai-test.bielcrystal.com/device-gateway',
      DISABLE_APP_UPDATE: '1',
      RAYON_NUM_THREADS: '2',
      NODE_OPTIONS: '--max-old-space-size=2048',
    };
    await desktop(env);
    return;
  }
  if (command === 'help') {
    console.log(
      'Local development: init | setup | start | desktop | desktop-test | doctor | stop | seed',
    );
    return;
  }
  if (command === 'setup') initialize();
  const config = loadConfig();
  let env = localEnvironment(config);
  if (command === 'setup') {
    run('docker', ['info'], { capture: true });
    compose(config, ['up', '-d', '--wait', 'postgres', 'redis', 'storage', 'gateway', 'qstash']);
    compose(config, ['run', '--rm', 'storage-init']);
    if (config.c.SEARCH_ENABLED === '1')
      compose(config, ['--profile', 'search', 'up', '-d', 'search']);
    await migrateLocal(config);
    console.log(`Infrastructure ready. Add your Aihub key to ${configFile}; run pnpm dev:local.`);
    return;
  }
  if (command === 'start') {
    await assertPortsFree([config.c.WEB_PORT, config.c.NEXT_PORT, config.c.VITE_PORT]);
    compose(config, ['up', '-d', '--wait', 'postgres', 'redis', 'storage', 'gateway', 'qstash']);
    compose(config, ['run', '--rm', 'storage-init']);
    if (config.c.SEARCH_ENABLED === '1')
      compose(config, ['--profile', 'search', 'up', '-d', 'search']);
    await migrateLocal(config);
    await waitFor(env.QSTASH_URL!, 30_000);
    env = { ...env, ...workflowEnvironment(config) };
    Object.assign(process.env, env);
    const proxy = await startProxy(config, () => {
      stopChildren();
      proxy.close();
      setTimeout(() => process.exit(0), 1500).unref();
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        stopChildren();
        proxy.close();
        setTimeout(() => process.exit(0), 1500).unref();
      });
    process.once('exit', stopChildren);
    launch(
      'next',
      node,
      [
        '--require',
        path.join(root, 'scripts/local-dev/next-env.cjs'),
        path.join(root, 'node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '-p',
        config.c.NEXT_PORT,
      ],
      env,
    );
    launch(
      'vite',
      node,
      [
        path.join(root, 'node_modules/vite/bin/vite.js'),
        '--host',
        'localhost',
        '--strictPort',
        '--port',
        config.c.VITE_PORT,
      ],
      env,
    );
    try {
      console.log('Preparing local authentication and memory worker...');
      await waitFor(`${config.origin}/api/auth/get-session`, 600_000);
      let response = await authRequest(config, 'sign-in/email');
      if (!response.ok) {
        response = await authRequest(config, 'sign-up/email');
        if (!response.ok)
          throw new Error(
            `Better Auth account initialization failed (${response.status}); see Next logs.`,
          );
      }
      await seedLocal(loadConfig());
      console.log(
        'Preparing current-branch business APIs (first compilation can take several minutes)...',
      );
      await waitFor(`${config.origin}/trpc/lambda/config.getGlobalConfig`, 600_000);
      await waitFor(`${config.origin}/api/desktop/auth-config`, 180_000);
      await waitFor(`${config.origin}/oidc/.well-known/openid-configuration`, 180_000);
      writeFileSync(
        path.join(stateDir, 'reports', 'runtime.json'),
        JSON.stringify(
          {
            instance: config.instance.id,
            environment: 'local',
            origin: config.origin,
            backend: `http://localhost:${config.c.NEXT_PORT}`,
            gateway: env.DEVICE_GATEWAY_URL,
            sha: run('git', ['rev-parse', 'HEAD'], { capture: true }),
            dirty: !!run('git', ['status', '--porcelain'], { capture: true }),
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      console.log(
        `\nLOCAL DEVELOPMENT READY\nWeb: ${config.origin}/__local-dev\nBackend: http://localhost:${config.c.NEXT_PORT} (current branch)\nGateway: ${env.DEVICE_GATEWAY_URL}\nDatabase: ${config.project}\nLogs: ${stateDir}/logs\nModel credential: ${config.c.AIHUB_API_KEY ? 'configured' : 'MISSING'}\nElectron: pnpm dev:desktop:local`,
      );
    } catch (e) {
      stopChildren();
      proxy.close();
      throw e;
    }
    return;
  }
  if (command === 'seed') {
    Object.assign(process.env, env);
    await seedLocal(config);
    return;
  }
  if (command === 'desktop') {
    const status = await fetch(`${config.origin}/__local-dev/status`).then((r) => r.json());
    if (status.instance !== config.instance.id)
      throw new Error('A different backend owns the configured local origin.');
    await desktop({
      ...systemEnvironment(),
      NODE_ENV: 'development',
      MASTERINO_DEV_ENV: 'local',
      MASTERINO_DESKTOP_PROFILE: `local-${config.instance.id}`,
      OFFICIAL_CLOUD_SERVER: config.origin,
      NEXT_PUBLIC_DESKTOP_CLOUD_SERVER: config.origin,
      NEXT_PUBLIC_MARKET_BASE_URL: env.NEXT_PUBLIC_MARKET_BASE_URL!,
      DEVICE_GATEWAY_URL: env.DEVICE_GATEWAY_URL!,
      DISABLE_APP_UPDATE: '1',
      RAYON_NUM_THREADS: '2',
      NODE_OPTIONS: '--max-old-space-size=2048',
    });
    return;
  }
  if (command === 'stop') {
    try {
      const status = await fetch(`${config.origin}/__local-dev/status`).then((r) => r.json());
      if (status.instance !== config.instance.id)
        throw new Error('Refusing to stop a different local instance.');
      const r = await fetch(`${config.origin}/__local-dev/stop`, {
        method: 'POST',
        headers: { 'Origin': config.origin, 'x-masterino-owner': config.instance.gatewayToken },
      });
      if (!r.ok) throw new Error('Stop rejected');
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
    }
    compose(config, ['--profile', 'search', 'stop']);
    console.log('Local services stopped; data volumes retained.');
    return;
  }
  if (command === 'doctor') {
    verifyDatabaseOwner(config);
    const report: Record<string, unknown> = {
      instance: config.project,
      origin: config.origin,
      modelConfigured: !!config.c.AIHUB_API_KEY,
      postgres: compose(
        config,
        ['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'masterino_local'],
        true,
      ).includes('accepting connections')
        ? 'ready'
        : 'unavailable',
      redis:
        compose(config, ['exec', '-T', 'redis', 'redis-cli', 'ping'], true) === 'PONG'
          ? 'ready'
          : 'unavailable',
    };
    for (const [key, url] of Object.entries({
      proxy: `${config.origin}/__local-dev/status`,
      backend: `${config.origin}/api/auth/get-session`,
      qstash: `http://127.0.0.1:${config.c.QSTASH_PORT}/v2/topics`,
      gateway: `http://localhost:${config.c.GATEWAY_PORT}/health`,
      storage: `http://127.0.0.1:${config.c.S3_PORT}/health`,
    }))
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          ...(key === 'qstash'
            ? { headers: { Authorization: `Bearer ${workflowEnvironment(config).QSTASH_TOKEN}` } }
            : {}),
        });
        report[key] = response.ok ? 'ready' : `HTTP ${response.status}`;
      } catch {
        report[key] = 'unavailable';
      }
    if (process.argv.includes('--models')) {
      const { checkModels } = await import('./models.mjs');
      report.models = await checkModels(config);
    }
    writeFileSync(path.join(stateDir, 'reports', 'doctor.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (
      ['proxy', 'backend', 'postgres', 'redis', 'gateway', 'storage', 'qstash'].some(
        (k) => report[k] !== 'ready',
      )
    )
      process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown local development command: ${command}`);
}
async function desktop(env: NodeJS.ProcessEnv) {
  await assertPortsFree(['5173']);
  // Gateway-dispatched Codex/Claude Code runs use the desktop's lh launcher.
  // Rebuild the current branch CLI so a fresh checkout never starts a dangling launcher.
  console.log('Building the local CLI used by desktop agent execution...');
  run(node, [path.join(root, 'apps/cli/node_modules/tsdown/dist/run.mjs')], {
    cwd: path.join(root, 'apps/cli'),
    env,
  });
  console.log(
    `Electron environment: ${env.MASTERINO_DEV_ENV}\nBackend: ${env.OFFICIAL_CLOUD_SERVER}\nGateway: ${env.DEVICE_GATEWAY_URL}\nProfile: ${env.MASTERINO_DESKTOP_PROFILE}`,
  );
  const child = spawn(
    node,
    [path.join(root, 'apps/desktop/node_modules/electron-vite/bin/electron-vite.js'), 'dev'],
    {
      cwd: path.join(root, 'apps/desktop'),
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  );
  const stopDesktop = () => {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      // The child process group may already have exited.
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stopDesktop);
  process.once('exit', stopDesktop);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      stopDesktop();
      process.exitCode = code || 0;
      resolve();
    });
  });
}
main().catch((error) => {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
