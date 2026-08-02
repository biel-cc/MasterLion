// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = process.cwd();
const testOverlay = path.join(root, 'k8s', 'overlays', 'test');

describe('test OnlyBoxes sandbox configuration', () => {
  it('uses internal OnlyBoxes without enabling Market', async () => {
    const configMap = parse(await readFile(path.join(testOverlay, 'configmap.yaml'), 'utf8'));
    const memoryProperties = await readFile(path.join(testOverlay, 'memory.properties'), 'utf8');

    expect(configMap.data).toMatchObject({
      ONLYBOXES_BASE_URL: 'https://onlyboxes.internal.bielcrystal.com',
      ONLYBOXES_JIT_ISSUER: 'https://mlai-test.bielcrystal.com',
      SANDBOX_PROVIDER: 'onlyboxes',
    });
    expect(configMap.data).not.toHaveProperty('MARKET_BASE_URL');
    expect(configMap.data).not.toHaveProperty('MARKET_ALLOW_EXTERNAL_FALLBACK');
    expect(memoryProperties).toContain('FEATURE_FLAGS=+memory,-market');
  });

  it('pins the TLS hostname locally and mounts the OnlyBoxes trust material', async () => {
    const kustomization = await readFile(path.join(testOverlay, 'kustomization.yaml'), 'utf8');
    const deployScript = await readFile(path.join(root, 'deploy.sh'), 'utf8');

    expect(kustomization).toContain('ip: 10.80.137.220');
    expect(kustomization).toContain('onlyboxes.internal.bielcrystal.com');
    expect(kustomization).toContain('masterino-onlyboxes-secret');
    expect(kustomization).toContain('masterino-onlyboxes-ca');
    expect(deployScript).toContain('masterino-onlyboxes-secret is missing');
    expect(deployScript).toContain('masterino-onlyboxes-ca is missing');
  });
});
