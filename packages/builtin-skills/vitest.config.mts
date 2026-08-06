import { readFile } from 'node:fs/promises';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      async load(id) {
        if (id.endsWith('.md')) {
          return `export default ${JSON.stringify(await readFile(id, 'utf8'))}`;
        }
      },
      name: 'raw-markdown',
    },
  ],
  test: {
    environment: 'node',
  },
});
