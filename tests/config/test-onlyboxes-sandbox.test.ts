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
    expect(deployScript).toContain('ACR_PULL_SECRET_NAME="masterino-acr-fixed"');
    expect(deployScript).toContain('render_deploy_manifests');
    expect(deployScript).toContain('if ($0 == "kind: StorageClass") is_storage_class = 1');

    const checkSecret = deployScript.slice(
      deployScript.indexOf('check_secret()'),
      deployScript.indexOf('service_resource()'),
    );
    expect(checkSecret).not.toContain('masterlion-searxng-secret');
  });

  it('does not construct Market services on OnlyBoxes sandbox or skill read paths', async () => {
    const toolsRouter = await readFile(
      path.join(root, 'apps', 'server', 'src', 'routers', 'tools', 'market.ts'),
      'utf8',
    );
    const skillsRouter = await readFile(
      path.join(root, 'apps', 'server', 'src', 'routers', 'lambda', 'agentSkills.ts'),
      'utf8',
    );

    const sandboxProcedure = toolsRouter.slice(
      toolsRouter.indexOf('const sandboxToolProcedure'),
      toolsRouter.indexOf('// ============================== LobeHub Skill Procedures'),
    );
    expect(sandboxProcedure).toContain("sandboxEnv.SANDBOX_PROVIDER === 'market'");
    expect(toolsRouter).toContain('execInSandbox: sandboxToolProcedure');
    expect(toolsRouter).toContain('exportAndUploadFile: sandboxToolProcedure');
    expect(toolsRouter).toContain('marketService?: MarketService');

    const skillProcedure = skillsRouter.slice(
      skillsRouter.indexOf('const skillProcedure'),
      skillsRouter.indexOf('// Writes:'),
    );
    const importFromMarket = skillsRouter.slice(
      skillsRouter.indexOf('importFromMarket:'),
      skillsRouter.indexOf('list: skillProcedure'),
    );
    expect(skillProcedure).not.toContain('new MarketService');
    expect(importFromMarket).toContain('new MarketService');
  });

  it('does not query Market credentials when the Market feature is disabled', async () => {
    const contextEngineering = await readFile(
      path.join(root, 'src', 'services', 'chat', 'mecha', 'contextEngineering.ts'),
      'utf8',
    );
    const cloudConfigHook = await readFile(
      path.join(root, 'src', 'business', 'client', 'hooks', 'useHeteroAgentCloudConfig.ts'),
      'utf8',
    );
    const cloudProfile = await readFile(
      path.join(
        root,
        'src',
        'routes',
        '(main)',
        'agent',
        'profile',
        'features',
        'ProfileEditor',
        'CloudHeterogeneousConfig.tsx',
      ),
      'utf8',
    );

    expect(contextEngineering).toContain('if (isCredsEnabled && isMarketEnabled)');
    expect(contextEngineering).toContain('featureFlags?.showMarket === true');
    expect(cloudConfigHook).toContain('isClaudeCode && showMarket');
    expect(cloudProfile).toContain('{ enabled: showMarket }');
  });

  it('treats deployment -market as an authoritative runtime lock', async () => {
    const featureFlags = await readFile(
      path.join(root, 'apps', 'server', 'src', 'featureFlags', 'index.ts'),
      'utf8',
    );
    const credsRouter = await readFile(
      path.join(root, 'apps', 'server', 'src', 'routers', 'lambda', 'market', 'creds.ts'),
      'utf8',
    );

    expect(featureFlags).toContain("flag.trim() === '-market'");
    expect(featureFlags).toContain('applyDeploymentFeatureFlagLocks');
    expect(credsRouter).toContain('list: credsListProcedure');
    expect(credsRouter).toContain('if (!ctx.marketService) return { data: [] }');
  });
});
