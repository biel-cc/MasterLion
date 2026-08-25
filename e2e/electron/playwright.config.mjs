import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  outputDir: path.resolve(configDirectory, '.artifacts/test-results'),
  reporter: [['list']],
  testDir: './tests',
  timeout: 20_000,
  workers: 1,
});
