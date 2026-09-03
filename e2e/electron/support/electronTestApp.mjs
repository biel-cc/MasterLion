import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';

import { buildProductionLifecycle } from './buildProductionLifecycle.mjs';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(electronRoot, '../..');

const resolveElectronExecutable = () => {
  if (process.env.ELECTRON_EXECUTABLE_PATH) return process.env.ELECTRON_EXECUTABLE_PATH;

  try {
    const desktopRequire = createRequire(path.resolve(repositoryRoot, 'apps/desktop/package.json'));
    return desktopRequire('electron');
  } catch {
    // A graph worktree intentionally reuses the primary checkout's already-installed desktop
    // runtime. Resolve it through git's common directory without assuming a sibling name.
    const commonDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim();
    const primaryCheckout = path.dirname(commonDirectory);
    const primaryDesktopRequire = createRequire(
      path.resolve(primaryCheckout, 'apps/desktop/package.json'),
    );
    return primaryDesktopRequire('electron');
  }
};

export const launchElectronTestApp = async (options = {}) => {
  await buildProductionLifecycle();

  return electron.launch({
    args: [path.resolve(electronRoot, 'app/main.cjs')],
    env: {
      ...process.env,
      MASTERINO_ELECTRON_E2E: '1',
      ...options.env,
    },
    executablePath: resolveElectronExecutable(),
  });
};
