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
});
