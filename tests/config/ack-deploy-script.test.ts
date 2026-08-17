// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('guarded ACK deployment script', () => {
  it('normalizes mutually exclusive Kubernetes fields before server-side apply', async () => {
    const script = await readFile('deploy.sh', 'utf8');
    const normalization = script.indexOf('normalize_workload_schema_transitions\n');
    const applicationApply = script.indexOf('render_manifests "$deploy_overlay"', normalization);

    expect(script).toContain('"httpGet":null');
    expect(script).toContain('"tcpSocket":{"port":"http"}');
    expect(script).toContain('"name":"POSTGRES_DB","value":null,"valueFrom":{"configMapKeyRef"');
    expect(normalization).toBeGreaterThan(0);
    expect(applicationApply).toBeGreaterThan(normalization);
  });

  it('updates the test app and memory worker with one immutable image digest', async () => {
    const helper = await readFile('scripts/operations/deployAckTestWithAliyunCli.sh', 'utf8');

    expect(helper).toContain('app-update)');
    expect(helper).toContain('require_digest MASTERINO_IMAGE_DIGEST');
    expect(helper).toContain('update-image masterino');
    expect(helper).toContain('update-image memory-worker');
    expect(helper).toContain('$MASTERINO_IMAGE@$MASTERINO_IMAGE_DIGEST');
  });

  it('renders the production Device Gateway privately with an immutable single-replica image', async () => {
    const [config, deployment, kustomization] = await Promise.all([
      readFile('k8s/overlays/production/configmap.yaml', 'utf8'),
      readFile('k8s/overlays/production/device-gateway.yaml', 'utf8'),
      readFile('k8s/overlays/production/kustomization.yaml', 'utf8'),
    ]);

    expect(config).toContain("DEVICE_GATEWAY_URL: 'http://masterino-device-gateway:8788'");
    expect(deployment).toContain('replicas: 1');
    expect(deployment).toContain('readOnlyRootFilesystem: true');
    expect(deployment).toContain('runAsNonRoot: true');
    expect(deployment).toContain('runAsUser: 10001');
    expect(deployment).toContain('path: /health');
    expect(kustomization).toContain(
      'digest: sha256:bdb74578c3c8129d898bf628494afe0b7ff22bb0fcb7d62f9f8fdac50d5c463d',
    );
    expect(kustomization).toContain('name: DEVICE_GATEWAY_SERVICE_TOKEN');
    expect(kustomization).toContain('name: masterino-device-gateway-secret');
  });

  it('keeps the production Gateway Ingress behind a dedicated guarded cutover', async () => {
    const [ingress, production, script] = await Promise.all([
      readFile('k8s/overlays/production-gateway-cutover/device-gateway-ingress.yaml', 'utf8'),
      readFile('k8s/overlays/production/kustomization.yaml', 'utf8'),
      readFile('deploy.sh', 'utf8'),
    ]);

    expect(production).not.toContain('production-gateway-cutover');
    expect(ingress).toContain('host: masterino.bielcrystal.com');
    expect(ingress).toContain('path: /device-gateway(/|$)(.*)');
    expect(ingress).toContain("nginx.ingress.kubernetes.io/proxy-buffering: 'off'");
    expect(ingress).toContain("nginx.ingress.kubernetes.io/proxy-read-timeout: '3600'");
    expect(ingress).toContain('nginx.ingress.kubernetes.io/rewrite-target: /$2');
    expect(script).toContain('CONFIRM_GATEWAY_SECRET');
    expect(script).toContain('CONFIRM_GATEWAY_CUTOVER');
    expect(script).toContain('CONFIRM_GATEWAY_ROLLBACK');
    expect(script).toContain('JWKS_PUBLIC_KEY must contain public-only RS256 signing keys');
    expect(script).toContain('production SERVICE_TOKEN must not reuse the test Device Gateway token');
    expect(script).toContain('private Device Gateway health check did not return OK');
    expect(script).toContain('apply --server-side --field-manager=masterino-gateway-cutover');
    expect(script).toContain('delete ingress masterino-device-gateway');
  });
});
