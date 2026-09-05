import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: path.resolve(configDirectory, '.artifacts/test-results'),
  reporter: [['list']],
  testDir: '..',
  testMatch: ['electron/tests/**/*.spec.mjs', 'electron/workspace-runtime.spec.ts'],
  // The first spec to run bundles the production module graphs inside its
  // `beforeAll` (the artifacts are then reused by the other specs), and the
  // Workspace Runtime seams additionally migrate an isolated PGlite database
  // in the Electron main process. The budget has to cover that cold start
  // rather than just the assertions.
  timeout: 300_000,
  workers: 1,
});
