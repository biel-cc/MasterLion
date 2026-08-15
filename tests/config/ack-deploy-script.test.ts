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

  it('checks the Aihub models required by the v1.2 production configuration', async () => {
    const helper = await readFile('scripts/operations/deployAckTestWithAliyunCli.sh', 'utf8');

    expect(helper).toContain(
      'AIHUB_REQUIRED_CHAT_MODEL="${AIHUB_REQUIRED_CHAT_MODEL:-deepseek-v4-flash}"',
    );
    expect(helper).toContain(
      'AIHUB_REQUIRED_EMBEDDING_MODEL="${AIHUB_REQUIRED_EMBEDDING_MODEL:-text-embedding-3-large}"',
    );
  });
});
