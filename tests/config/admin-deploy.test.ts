// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

const adminHost = 'admin-mlai-test.bielcrystal.com';
const adminImage = 'boen-registry-vpc.cn-shenzhen.cr.aliyuncs.com/biel_client/masterino-admin';

describe('Masterino Admin test deployment', () => {
  it('keeps the deployment scoped to the test namespace and immutable image workflow', async () => {
    const script = await readFile('scripts/operations/deployAckTestAdminWithAliyunCli.sh', 'utf8');

    expect(script).toContain('NAMESPACE="masterino-test"');
    expect(script).toContain(`ADMIN_HOST="${adminHost}"`);
    expect(script).toContain(`ADMIN_IMAGE="${adminImage}"`);
    expect(script).toContain('ADMIN_IMAGE_DIGEST must be an immutable sha256 digest');
    expect(script).toContain('CONFIRM_ACK_TEST_ADMIN_DEPLOY=$NAMESPACE');
    expect(script).toContain('kubectl apply --dry-run=server');
    expect(script).not.toContain('masterino-production');
  });

  it('routes authentication and API traffic to the main app before the Admin SPA', async () => {
    const ingressText = await readFile('k8s/overlays/test-admin-cutover/ingress.yaml', 'utf8');
    const [document] = parseAllDocuments(ingressText).map((item) => item.toJS());
    const rule = document.spec.rules[0];
    const paths = rule.http.paths;

    expect(rule.host).toBe(adminHost);
    expect(document.spec.tls[0]).toEqual({
      hosts: [adminHost],
      secretName: '20261122bielcrystal.com',
    });
    expect(paths.map((item: any) => item.path)).toEqual([
      '/api',
      '/trpc',
      '/signin',
      '/_spa-auth',
      '/',
    ]);
    expect(paths.at(-1).backend.service).toEqual({
      name: 'masterino-admin',
      port: { number: 3020 },
    });
  });

  it('allows Better Auth to derive the Admin request origin', async () => {
    const configMap = await readFile('k8s/overlays/test/configmap.yaml', 'utf8');

    expect(configMap).toContain(`APP_URL_ALLOWED_HOSTS: 'mlai-test.bielcrystal.com,${adminHost}'`);
  });
});
