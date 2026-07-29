import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      '@': path.resolve(__dirname, './src/main'),
      '~common': path.resolve(__dirname, './src/common'),
      '@lobechat/device-control': path.resolve(__dirname, '../../packages/device-control/src'),
      '@lobechat/device-identity': path.resolve(__dirname, '../../packages/device-identity/src'),
      '@lobechat/local-file-shell': path.resolve(__dirname, '../../packages/local-file-shell/src'),
    },
    coverage: {
      all: false,
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
      reportsDirectory: './coverage/app',
    },
    environment: 'node',
    setupFiles: ['./src/main/__mocks__/setup.ts'],
  },
});
