import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareSkillPackage } from './skillPackage';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, Uint8Array>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'masterino-skill-package-'));
  roots.push(root);
  const bytes = zipSync(files);
  const zipHash = createHash('sha256').update(bytes).digest('hex');
  const download = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes));
  return { root, input: { url: 'https://files.example/skill.zip', zipHash }, download };
}

describe('device skill package preparation', () => {
  it('prepares verified files once for concurrent requests and reuses the cache', async () => {
    const f = await fixture({
      'SKILL.md': strToU8('skill'),
      'scripts/check.py': strToU8('print("ok")'),
    });
    const [first, second] = await Promise.all([
      prepareSkillPackage(f.input, f.root, f.download),
      prepareSkillPackage(f.input, f.root, f.download),
    ]);
    expect(first.extractedDir).toBe(second.extractedDir);
    expect(await readFile(path.join(first.extractedDir, 'scripts/check.py'), 'utf8')).toBe(
      'print("ok")',
    );
    await prepareSkillPackage(f.input, f.root, f.download);
    expect(f.download).toHaveBeenCalledTimes(1);
  });
  it('uses the SKILL.md directory for a wrapped ZIP, including cached loads', async () => {
    const f = await fixture({
      'wrapped/SKILL.md': strToU8('skill'),
      'wrapped/scripts/check.py': strToU8('print("wrapped")'),
    });
    const first = await prepareSkillPackage(f.input, f.root, f.download);
    expect(first.extractedDir).toBe(
      path.join(await realpath(f.root), 'extracted', f.input.zipHash, 'wrapped'),
    );
    expect(await readFile(path.join(first.extractedDir, 'scripts/check.py'), 'utf8')).toBe(
      'print("wrapped")',
    );
    expect((await prepareSkillPackage(f.input, f.root, f.download)).extractedDir).toBe(
      first.extractedDir,
    );
    expect(f.download).toHaveBeenCalledTimes(1);
  });

  it('rejects archive traversal without publishing a prepared cache', async () => {
    const f = await fixture({ '../escape': strToU8('bad') });
    await expect(prepareSkillPackage(f.input, f.root, f.download)).rejects.toThrow(
      'Unsafe skill archive path',
    );
    await expect(
      readFile(path.join(f.root, 'extracted', f.input.zipHash, '.prepared')),
    ).rejects.toThrow();
  });
  it('rejects a mismatched digest and unsafe cache key', async () => {
    const f = await fixture({ 'SKILL.md': strToU8('skill') });
    await expect(
      prepareSkillPackage({ ...f.input, zipHash: '0'.repeat(64) }, f.root, f.download),
    ).rejects.toThrow('hash mismatch');
    await expect(
      prepareSkillPackage({ ...f.input, zipHash: '../cache' }, f.root, f.download),
    ).rejects.toThrow('Invalid skill package hash');
  });
});
