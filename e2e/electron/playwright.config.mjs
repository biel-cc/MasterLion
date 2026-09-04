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
  // The first spec to run bundles the production renderer module graph inside
  // its `beforeAll` (the artifacts are then reused by the other specs), so the
  // budget has to cover a cold Vite build rather than just the assertions.
  timeout: 300_000,
  workers: 1,
});
