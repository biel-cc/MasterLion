import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseAllDocuments } from 'yaml';

import { root, systemEnvironment } from '../local-dev/config.mjs';
import { validateContainerAddresses } from './manifest-environment.mjs';

export function kubectlEnvironment(input = process.env): NodeJS.ProcessEnv {
  return {
    ...systemEnvironment(input),
    ...(input.KUBECONFIG !== undefined ? { KUBECONFIG: input.KUBECONFIG } : {}),
  };
}

function execute(args: string[]) {
  const r = spawnSync('kubectl', args, { cwd: root, env: kubectlEnvironment(), encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(
      'kubectl check failed; verify installation and the explicitly selected test context.',
    );
  return r.stdout;
}
export function validateTestManifests(documents: any[]) {
  const config = documents.find(
    (d) => d?.kind === 'ConfigMap' && d.metadata?.name === 'masterino-config',
  );
  if (!config || config.metadata.namespace !== 'masterino-test')
    throw new Error('Expected masterino-test ConfigMap.');
  if (config.data.APP_URL !== 'https://mlai-test.bielcrystal.com')
    throw new Error('Unexpected test APP_URL.');
  if (config.data.DEVICE_GATEWAY_URL !== 'http://masterino-device-gateway:8788')
    throw new Error('Unexpected test Gateway.');
  for (const doc of documents) {
    if (doc?.metadata?.namespace && doc.metadata.namespace !== 'masterino-test')
      throw new Error('Non-test namespace in rendered manifests.');
    const envs = [
      ...(doc?.spec?.template?.spec?.containers || []),
      ...(doc?.spec?.template?.spec?.initContainers || []),
    ].flatMap((c) => c.env || []);
    const entries = [
      ...Object.entries(doc?.kind === 'ConfigMap' ? doc.data || {} : {}).map(([name, value]) => ({
        name,
        value,
      })),
      ...envs,
    ];
    for (const item of entries)
      if (
        ['MASTERINO_DEV_ENV', 'ENABLE_MOCK_DEV_USER', 'MOCK_DEV_USER_ID'].includes(item.name) &&
        item.value
      )
        throw new Error('Development identity configuration present in test manifests.');
  }
  validateContainerAddresses(documents);
  return {
    environment: 'test',
    namespace: 'masterino-test',
    origin: config.data.APP_URL,
    gateway: config.data.DEVICE_GATEWAY_URL,
  };
}
async function main() {
  const rendered = execute(['kustomize', 'k8s/overlays/test']);
  const report: any = {
    ...validateTestManifests(parseAllDocuments(rendered).map((d) => d.toJSON())),
    checkedAt: new Date().toISOString(),
    mode: 'rendered configuration; no deployment performed',
  };
  if (process.argv.includes('--live')) {
    const i = process.argv.indexOf('--context');
    const context = process.argv[i + 1];
    if (i < 0 || !context || !context.toLowerCase().includes('test'))
      throw new Error(
        '--live requires an explicit test --context. Never uses the current default context.',
      );
    const data = JSON.parse(
      execute(['--context', context, '-n', 'masterino-test', 'get', 'deployments', '-o', 'json']),
    );
    report.deployments = data.items.map((d: any) => ({
      name: d.metadata.name,
      ready: d.status.readyReplicas || 0,
      images: d.spec.template.spec.containers.map((c: any) => ({ name: c.name, image: c.image })),
    }));
    report.context = context;
    report.mode = 'read-only test deployment inventory';
  }
  const dir = path.join(root, '.local-dev/reports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'test-environment.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1]?.endsWith('/check.mts'))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
