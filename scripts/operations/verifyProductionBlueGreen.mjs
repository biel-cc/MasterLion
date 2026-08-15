import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { parseAllDocuments } from 'yaml';

const render = (directory) => {
  const result = spawnSync('kubectl', ['kustomize', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `could not render ${directory}`);
  return parseAllDocuments(result.stdout).map((document) => document.toJSON());
};

const find = (resources, kind, name) =>
  resources.find((resource) => resource.kind === kind && resource.metadata?.name === name);

const validation = render('k8s/overlays/production-bluegreen');
const market = render('k8s/overlays/production-market');
const cutover = render('k8s/overlays/production-bluegreen-cutover');

const forbiddenValidationKinds = new Set([
  'Ingress',
  'Namespace',
  'PersistentVolumeClaim',
  'Secret',
  'StatefulSet',
]);
assert.equal(
  validation.some((resource) => forbiddenValidationKinds.has(resource.kind)),
  false,
  'validation overlay contains a public, stateful, or secret-bearing resource',
);

const app = find(validation, 'Deployment', 'masterino');
const bridge = find(validation, 'Deployment', 'masterino-aihub-db-bridge');
const memoryWorker = find(validation, 'Deployment', 'masterino-memory-worker');
const searxng = find(validation, 'Deployment', 'masterino-searxng');
const wecomVerification = find(validation, 'Deployment', 'masterino-wecom-verification');
assert(app, 'Masterino Deployment is missing');
assert(bridge, 'Masterino Aihub bridge Deployment is missing');
assert(memoryWorker, 'Masterino memory worker Deployment is missing');
assert(searxng, 'Masterino SearXNG Deployment is missing');
assert(wecomVerification, 'Masterino WeCom verification Deployment is missing');
assert.equal(app.spec.replicas, 1);
assert.match(app.spec.template.spec.containers[0].image, /masterino@sha256:acea845a/);
assert.match(bridge.spec.template.spec.containers[0].image, /sha256:9140209e/);
assert.equal(
  bridge.spec.selector.matchLabels['app.kubernetes.io/name'],
  'masterino-aihub-db-bridge',
);
assert.equal(
  find(validation, 'Service', 'masterino-aihub-db-bridge').spec.selector['app.kubernetes.io/name'],
  'masterino-aihub-db-bridge',
);
assert.equal(app.spec.template.spec.volumes[0].configMap.name, 'masterino-onlyboxes-ca');
const memoryConfigRef = app.spec.template.spec.containers[0].envFrom.find((source) =>
  source.configMapRef?.name?.startsWith('masterino-memory-config-'),
);
assert(memoryConfigRef, 'Masterino app is not wired to the content-hashed memory ConfigMap');
const memoryConfig = validation.find(
  (resource) =>
    resource.kind === 'ConfigMap' &&
    resource.metadata?.name?.startsWith('masterino-memory-config-'),
);
assert(memoryConfig, 'Masterino memory ConfigMap is missing');
assert.equal(memoryConfig.data.FEATURE_FLAGS, '+memory');
assert.equal(memoryConfig.data.MEMORY_USER_MEMORY_GATEKEEPER_MODEL, 'deepseek-v4-flash');
assert.equal(memoryConfig.data.MEMORY_USER_MEMORY_LAYER_EXTRACTOR_MODEL, 'deepseek-v4-flash');
assert.equal(memoryConfig.data.MEMORY_USER_MEMORY_PERSONA_WRITER_MODEL, 'deepseek-v4-flash');
assert.equal(memoryConfig.data.MEMORY_USER_MEMORY_EMBEDDING_MODEL, 'text-embedding-3-large');
assert.match(memoryWorker.spec.template.spec.containers[0].image, /masterino@sha256:acea845a/);
const memoryWorkerEnv = Object.fromEntries(
  memoryWorker.spec.template.spec.containers[0].env.map(({ name, value }) => [name, value]),
);
assert.equal(memoryWorkerEnv.MEMORY_QUEUE_WORKER_ENABLED, '1');
assert.equal(memoryWorkerEnv.MEMORY_QUEUE_SCHEDULER_ENABLED, '1');
assert.equal(memoryWorkerEnv.AIHUB_READONLY_DATABASE_URL, '');
assert.match(searxng.spec.template.spec.containers[0].image, /searxng@sha256:663c20b2/);
assert.equal(
  searxng.spec.template.spec.containers[0].env.find(({ name }) => name === 'SEARXNG_SECRET')
    .valueFrom.secretKeyRef.name,
  'masterino-secret',
);
assert.equal(
  find(validation, 'Service', 'masterino-searxng').spec.selector['app.kubernetes.io/name'],
  'masterino-searxng',
);
assert.equal(
  find(validation, 'Service', 'masterino-wecom-verification').spec.selector[
    'app.kubernetes.io/name'
  ],
  'masterino-wecom-verification',
);
assert.equal(
  wecomVerification.spec.selector.matchLabels['app.kubernetes.io/name'],
  'masterino-wecom-verification',
);
assert.match(wecomVerification.spec.template.spec.containers[0].image, /masterino@sha256:acea845a/);
const appConfig = find(validation, 'ConfigMap', 'masterino-config');
assert.equal(appConfig.data.APP_URL, 'https://masterino.bielcrystal.com');
assert.equal(appConfig.data.MARKET_BASE_URL, 'http://masterino-market:3220');
assert.equal(appConfig.data.MARKET_ALLOW_EXTERNAL_FALLBACK, '0');
assert.equal(appConfig.data.SEARCH_PROVIDERS, 'searxng');
assert.equal(appConfig.data.AIHUB_DEFAULT_MODEL, 'deepseek-v4-flash');
assert.equal(appConfig.data.AIHUB_QUOTA_DISPLAY_TYPE, 'CNY');
assert.equal(appConfig.data.AIHUB_QUOTA_PER_UNIT, '500000');
assert.equal(appConfig.data.AIHUB_USD_EXCHANGE_RATE, '7.12');
assert.equal(appConfig.data.S3_PREVIEW_URL_EXPIRE_IN, '7200');
assert.equal(appConfig.data.CHUNKS_AUTO_GEN_METADATA, '1');
assert.equal(appConfig.data.EMBEDDING_BATCH_SIZE, '50');
assert.equal(appConfig.data.EMBEDDING_CONCURRENCY, '10');
assert.equal(appConfig.data.REDIS_DATABASE, '0');
assert.equal(appConfig.data.ONLYBOXES_JIT_TTL_SEC, '1800');
assert.equal(appConfig.data.ONLYBOXES_LEASE_TTL_SEC, '900');
assert.equal(appConfig.data.OFFICECLI_ENABLED, 'true');

assert.equal(
  market.some((resource) => resource.kind === 'Ingress'),
  false,
);
assert.equal(
  market.some((resource) => resource.metadata?.name === 'masterino-market-runner'),
  false,
  'Connector Runner must remain disabled until its proxy is provisioned',
);
assert(find(market, 'Job', 'masterino-market-migrate'));
const marketDeployment = find(market, 'Deployment', 'masterino-market');
assert(marketDeployment);
assert.match(
  marketDeployment.spec.template.spec.containers[0].image,
  /masterino-market@sha256:53582abdb90b8672e8e2662ae0968530cb3fc13fb8d025e5c41501e2f9660242/,
);
assert(find(market, 'HorizontalPodAutoscaler', 'masterino-market'));
assert(find(market, 'PodDisruptionBudget', 'masterino-market'));
const marketPolicy = find(market, 'NetworkPolicy', 'masterino-market-api-no-public-egress');
assert(marketPolicy);
assert.match(JSON.stringify(marketPolicy.spec.egress), /10\.80\.136\.163\/32/);
assert.match(JSON.stringify(marketPolicy.spec.egress), /"port":443/);

const cutoverApp = find(cutover, 'Deployment', 'masterino');
assert.equal(cutoverApp.spec.replicas, 2);
const ingresses = cutover.filter((resource) => resource.kind === 'Ingress');
assert.equal(ingresses.length, 2);
const appIngress = find(cutover, 'Ingress', 'masterino-maintenance');
const marketIngress = find(cutover, 'Ingress', 'masterino-market');
assert.equal(
  appIngress.spec.rules[0].http.paths.find((path) => path.path === '/').backend.service.name,
  'masterino',
);
assert.equal(marketIngress.spec.rules[0].http.paths[0].path, '/market(/|$)(.*)');

console.log('Production blue-green and Market manifest verification passed.');
