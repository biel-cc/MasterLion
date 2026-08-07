import { describe, expect, it } from 'vitest';

import { validateZipArchive } from './crypto.js';
import { CURATED_SEED_BATCH, curatedResources } from './curatedCatalog.js';
import { createStoredZip } from './zip.js';

describe('curated community catalog', () => {
  it('contains exactly five published candidates for each supported community type', () => {
    const counts = curatedResources.reduce<Record<string, number>>((result, item) => {
      result[item.type] = (result[item.type] || 0) + 1;
      return result;
    }, {});

    expect(counts).toEqual({ agent: 5, mcp: 5, skill: 5 });
    expect(new Set(curatedResources.map((item) => item.resource.identifier)).size).toBe(15);
    expect(curatedResources.some((item) => ['model', 'provider'].includes(item.type))).toBe(false);
  });

  it('records traceable internal rewrites for every SkillHub-inspired skill', () => {
    const skills = curatedResources.filter((item) => item.type === 'skill');

    for (const item of skills) {
      expect(item.resource.identifier).not.toBe('office-documents');
      expect(item.resource.metadata).toMatchObject({
        adaptation: 'internal-rewrite',
        seedBatchId: CURATED_SEED_BATCH,
        sourceCatalog: 'skillhub.cn',
      });
      expect(item.resource.metadata.sourceUrl).toMatch(/^https:\/\/skillhub\.cn\/skills\//);
      expect(item.resource.metadata.sourceIdentifier).toBeTruthy();
      expect(item.resource.metadata.sourceAuthor).toBeTruthy();
      expect(item.resource.metadata.sourceVersion).toBe('catalog-snapshot-2026-08-07');
      expect(item.resource.metadata.license).toBe('Masterino-internal');
      expect(item.resource.metadata.reviewedAt).toBeTruthy();
    }
  });

  it('builds safe deterministic ZIP packages for curated skills', () => {
    for (const item of curatedResources.filter((candidate) => candidate.artifact)) {
      const first = createStoredZip(item.artifact!.files);
      const second = createStoredZip(item.artifact!.files);

      expect(first.equals(second)).toBe(true);
      expect(validateZipArchive(first)).toEqual([]);
    }
  });

  it('uses remote HTTP MCP manifests with explicit auth modes', () => {
    for (const item of curatedResources.filter((candidate) => candidate.type === 'mcp')) {
      const connection = item.resource.manifest.deploymentOptions[0].connection;
      expect(connection.type).toBe('http');
      expect(connection.url).toMatch(/^https:\/\//);
      expect(['none', 'oauth2']).toContain(connection.auth.type);
    }
  });
});
