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

  const desktopRequire = createRequire(path.resolve(repositoryRoot, 'apps/desktop/package.json'));
  return desktopRequire('electron');
};

export const launchElectronTestApp = async () => {
  await buildProductionLifecycle();

  return electron.launch({
    args: [path.resolve(electronRoot, 'app/main.cjs')],
    env: {
      ...process.env,
      MASTERINO_ELECTRON_E2E: '1',
    },
    executablePath: resolveElectronExecutable(),
  });
};
