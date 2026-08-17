// @vitest-environment node
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('Masterino Onlyboxes runtime contract', () => {
  it('pins the balanced data and Office capability add-ons', async () => {
    const requirements = await readFile('deploy/onlyboxes/runtime-requirements.txt', 'utf8');

    for (const dependency of [
      'duckdb',
      'fastexcel',
      'polars',
      'pyarrow',
      'python-pptx',
      'seaborn',
      'statsmodels',
      'XlsxWriter',
    ]) {
      expect(requirements).toMatch(new RegExp(`^${dependency}==[^\\s\\\\]+`, 'im'));
    }
    expect(requirements.match(/--hash=sha256:/g)?.length).toBeGreaterThanOrEqual(13);
    expect(requirements).not.toContain('kaleido');
    expect(requirements).not.toContain('torch');
  });

  it('requires immutable inputs and embeds manifest plus offline smoke checks', async () => {
    const dockerfile = await readFile('deploy/onlyboxes/Dockerfile.office-runtime', 'utf8');

    expect(dockerfile).toContain('ARG ONLYBOXES_RUNTIME_BASE');
    expect(dockerfile).not.toContain('ARG ONLYBOXES_RUNTIME_BASE=');
    expect(dockerfile).toContain('ONLYBOXES_RUNTIME_BASE must use an immutable digest');
    expect(dockerfile).toContain('MASTERINO_PYPI_INDEX_URL');
    expect(dockerfile).toContain('--no-deps');
    expect(dockerfile).toContain('--require-hashes');
    expect(dockerfile).toContain('/opt/masterino/runtime-manifest.json');
    expect(dockerfile).toContain('/opt/masterino/runtime-requirements.txt');
    expect(dockerfile).toContain('runtime-smoke.py --quick');
    expect(dockerfile).toContain('fonts-crosextra-carlito=20230309-2');
    expect(dockerfile).toContain('fonts-crosextra-caladea=20200211-2');
  });

  it('uses one digest and reserves N+1 capacity for thirty concurrent sessions', async () => {
    const workerEnv = await readFile('deploy/onlyboxes/onlyboxes-worker.env.example', 'utf8');
    const service = await readFile('deploy/onlyboxes/onlyboxes-worker.service', 'utf8');
    const imageLines = workerEnv
      .split(/\r?\n/)
      .filter((line) => line.startsWith('WORKER_') && line.includes('DOCKER_IMAGE='));

    expect(imageLines).toHaveLength(2);
    expect(imageLines[0].split('=', 2)[1]).toBe(imageLines[1].split('=', 2)[1]);
    expect(imageLines[0]).toContain('@sha256:');
    expect(workerEnv).toContain('WORKER_TERMINAL_EXEC_MAX_INFLIGHT=10');
    expect(workerEnv).toContain('WORKER_TERMINAL_RESOURCE_MAX_INFLIGHT=10');
    expect(workerEnv).toContain('WORKER_TERMINAL_MAX_ACTIVE_SESSIONS=50');
    expect(workerEnv).toContain('WORKER_TERMINAL_EXEC_MEMORY_MIB=2048');
    expect(service).toContain('runtime-smoke.py --quick');
    expect(service).toContain('--network none');
  });
});
