import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { verifyAckTestManifests } from './verifyAckTestManifests.mjs';

describe('ACK test manifests', () => {
  it('keep active workloads isolated in masterino-test', () => {
    const rendered = execFileSync('kubectl', ['kustomize', 'k8s/overlays/test'], {
      encoding: 'utf8',
    });

    expect(() => verifyAckTestManifests(rendered)).not.toThrow();
  });

  it('rejects a cross-namespace SearXNG dependency', () => {
    const rendered = execFileSync('kubectl', ['kustomize', 'k8s/overlays/test'], {
      encoding: 'utf8',
    }).replace(
      'http://masterino-searxng:8080',
      'http://masterlion-searxng.masterlion-test.svc:8080',
    );

    expect(() => verifyAckTestManifests(rendered)).toThrow();
  });

  it('rejects restart-compatible search configuration drift', () => {
    const rendered = execFileSync('kubectl', ['kustomize', 'k8s/overlays/test'], {
      encoding: 'utf8',
    });
    const fallbackMarker = rendered.indexOf(
      'masterino.io/config-role: restart-compatible-fallback',
    );
    const searchSetting = rendered.indexOf('SEARCH_PROVIDERS: searxng', fallbackMarker);
    expect(fallbackMarker).toBeGreaterThan(-1);
    expect(searchSetting).toBeGreaterThan(fallbackMarker);
    const drifted =
      rendered.slice(0, searchSetting) +
      'SEARCH_PROVIDERS: disabled' +
      rendered.slice(searchSetting + 'SEARCH_PROVIDERS: searxng'.length);

    expect(() => verifyAckTestManifests(drifted)).toThrow();
  });
});
