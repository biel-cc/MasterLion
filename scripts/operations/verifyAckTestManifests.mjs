import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import YAML from 'yaml';

const { parseAllDocuments } = YAML;

const namespacedKinds = new Set([
  'ConfigMap',
  'Deployment',
  'Ingress',
  'PersistentVolumeClaim',
  'Secret',
  'Service',
  'StatefulSet',
]);

const find = (resources, kind, name) =>
  resources.find((resource) => resource.kind === kind && resource.metadata?.name === name);

export const verifyAckTestManifests = (yaml) => {
  const resources = parseAllDocuments(yaml).map((document) => document.toJSON());

  for (const resource of resources) {
    if (namespacedKinds.has(resource.kind)) {
      assert.equal(
        resource.metadata?.namespace,
        'masterino-test',
        `${resource.kind}/${resource.metadata?.name} must use namespace masterino-test`,
      );
    }
    if (['Deployment', 'Service', 'StatefulSet'].includes(resource.kind)) {
      assert.doesNotMatch(
        resource.metadata?.name || '',
        /^masterlion-/,
        `${resource.kind} still uses the retired masterlion workload prefix`,
      );
    }
  }

  assert.doesNotMatch(yaml, /\.masterlion-test\.svc(?:\.|:|\/)/);
  assert.doesNotMatch(yaml, /masterlion-searxng/);

  const app = find(resources, 'Deployment', 'masterino');
  const bridge = find(resources, 'Deployment', 'masterino-aihub-db-bridge');
  const worker = find(resources, 'Deployment', 'masterino-memory-worker');
  const searxng = find(resources, 'Deployment', 'masterino-searxng');
  const deviceGateway = find(resources, 'Deployment', 'masterino-device-gateway');
  assert(app, 'Masterino Deployment is missing');
  assert(bridge, 'Aihub Bridge Deployment is missing');
  assert(worker, 'Memory Worker Deployment is missing');
  assert(searxng, 'SearXNG Deployment is missing');
  assert(deviceGateway, 'Device Gateway Deployment is missing');
  assert(find(resources, 'Service', 'masterino-searxng'), 'SearXNG Service is missing');
  assert(find(resources, 'Service', 'masterino-device-gateway'), 'Device Gateway Service is missing');

  const appConfig = resources.find(
    (resource) =>
      resource.kind === 'ConfigMap' && resource.metadata?.name?.startsWith('masterino-config-'),
  );
  const bridgeConfig = resources.find(
    (resource) =>
      resource.kind === 'ConfigMap' &&
      resource.metadata?.name?.startsWith('masterino-bridge-config-'),
  );
  assert(appConfig, 'content-hashed Masterino ConfigMap is missing');
  assert(bridgeConfig, 'content-hashed Bridge ConfigMap is missing');
  assert.equal(appConfig.data.SEARCH_PROVIDERS, 'searxng');
  assert.equal(appConfig.data.SEARXNG_URL, 'http://masterino-searxng:8080');
  assert.equal(appConfig.data.CRAWLER_IMPLS, 'naive,jina');
  assert.equal(appConfig.data.DEVICE_GATEWAY_URL, 'http://masterino-device-gateway:8788');

  const appConfigRef = app.spec.template.spec.containers[0].envFrom.find(
    ({ configMapRef }) => configMapRef?.name === appConfig.metadata.name,
  );
  const workerConfigRef = worker.spec.template.spec.containers[0].envFrom.find(
    ({ configMapRef }) => configMapRef?.name === appConfig.metadata.name,
  );
  assert(appConfigRef, 'Masterino does not reference the hashed application ConfigMap');
  assert(workerConfigRef, 'Memory Worker does not reference the hashed application ConfigMap');

  const bridgeConfigRefs = bridge.spec.template.spec.containers[0].env
    .filter(({ valueFrom }) => valueFrom?.configMapKeyRef)
    .map(({ valueFrom }) => valueFrom.configMapKeyRef.name);
  assert.deepEqual(
    new Set(bridgeConfigRefs),
    new Set([bridgeConfig.metadata.name]),
    'Bridge must only reference its hashed ConfigMap',
  );

  assert.equal(app.spec.strategy.rollingUpdate.maxUnavailable, 0);
  assert.equal(app.spec.strategy.rollingUpdate.maxSurge, 1);
  assert.equal(app.spec.minReadySeconds, 10);
  assert.equal(
    app.spec.template.spec.containers[0].readinessProbe.httpGet.path,
    '/api/healthz',
  );
  assert.equal(
    bridge.spec.template.spec.containers[0].readinessProbe.httpGet.path,
    '/health',
  );
  assert.equal(
    searxng.spec.template.spec.containers[0].readinessProbe.httpGet.path,
    '/healthz',
  );
  assert.equal(
    searxng.spec.template.spec.containers[0].env.find(({ name }) => name === 'SEARXNG_SECRET')
      .valueFrom.secretKeyRef.name,
    'masterino-searxng-secret',
  );
  assert.equal(
    app.spec.template.spec.containers[0].env.find(
      ({ name }) => name === 'DEVICE_GATEWAY_SERVICE_TOKEN',
    ).valueFrom.secretKeyRef.name,
    'masterino-device-gateway-secret',
  );

  return resources;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyAckTestManifests(readFileSync(0, 'utf8'));
  console.log('ACK test namespace and deployment invariants passed.');
}
