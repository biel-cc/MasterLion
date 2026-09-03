import { spawn } from 'node:child_process';

let cachedPathPromise: Promise<string | undefined> | undefined;

const discoverLoginShellPath = async (): Promise<string | undefined> => {
  if (process.platform === 'win32') return;

  return new Promise((resolve) => {
    const shell = process.env.SHELL?.trim() || '/bin/sh';
    const child = spawn(shell, ['-ilc', 'printf %s "$PATH"'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value?.trim() || undefined);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, 5000);
    timer.unref();
    child.stdout?.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    child.once('error', () => finish());
    child.once('exit', (code) =>
      finish(code === 0 ? Buffer.concat(chunks).toString('utf8') : undefined),
    );
  });
};

/** Resolve once per device process; failures intentionally retain the inherited PATH. */
export const resolveLoginShellPath = (): Promise<string | undefined> =>
  (cachedPathPromise ??= discoverLoginShellPath());

export const resetLoginShellPathCacheForTest = (): void => {
  cachedPathPromise = undefined;
};
