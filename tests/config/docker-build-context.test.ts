// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('Docker build context', () => {
  it('excludes local release caches and production credentials', async () => {
    const dockerIgnore = await readFile('.dockerignore', 'utf8');

    expect(dockerIgnore).toContain('.sync-cache/');
    expect(dockerIgnore).toContain('.release*/');
    expect(dockerIgnore).toContain('deploy/.env*.prod');
    expect(dockerIgnore).toContain('k8s/*secret*.yaml');
    expect(dockerIgnore).toContain('k8s/**/*secret*.yaml');
  });
});
