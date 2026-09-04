import { describe, expect, it } from 'vitest';

import { isWithinRoot, parseAutoPathConsentEvidence } from './evidence';

const entry = (overrides: Record<string, unknown> = {}) => ({
  deviceId: 'device-1',
  mode: 'read',
  operationId: 'op-1',
  path: '/home/me/docs',
  rootPath: '/home/me/docs',
  scopeVerdict: 'consent:op-1',
  source: 'direct-user-message',
  toolCallId: 'call-1',
  topicId: 'topic-1',
  ...overrides,
});

describe('isWithinRoot', () => {
  it.each([
    ['/home/me/docs', '/home/me/docs', true],
    ['/home/me/docs', '/home/me/docs/a.txt', true],
    ['/home/me/docs/', '/home/me/docs/a/b.txt', true],
    ['/home/me/docs', '/home/me/docsx/a.txt', false],
    ['/home/me/docs', '/home/me', false],
    ['/', '/etc/passwd', true],
  ])('%s covers %s → %s', (root, target, expected) => {
    expect(isWithinRoot(root, target)).toBe(expected);
  });
});

describe('parseAutoPathConsentEvidence', () => {
  it('reports the authorization root, not the file the tool actually read', () => {
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [entry({ path: '/home/me/docs/a.txt' })],
      }),
    ).toEqual({
      deviceId: 'device-1',
      operationId: 'op-1',
      roots: ['/home/me/docs'],
      topicId: 'topic-1',
    });
  });

  it('collapses several targets that share one authorized root', () => {
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [
          entry({ path: '/home/me/docs/a.txt' }),
          entry({ path: '/home/me/docs/deep/b.txt' }),
          entry({ path: '/home/me/docs' }),
          entry({ path: '/home/me/notes/c.txt', rootPath: '/home/me/notes' }),
        ],
      })?.roots,
    ).toEqual(['/home/me/docs', '/home/me/notes']);
  });

  it('counts the three-root cap in roots, not in audited targets', () => {
    const manyTargetsOneRoot = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      entry({ path: `/home/me/docs/${name}.txt` }),
    );
    expect(parseAutoPathConsentEvidence({ scopeAudit: manyTargetsOneRoot })?.roots).toEqual([
      '/home/me/docs',
    ]);

    const fourRoots = ['/a', '/b', '/c', '/d'].map((root) =>
      entry({ path: `${root}/file.txt`, rootPath: root }),
    );
    expect(parseAutoPathConsentEvidence({ scopeAudit: fourRoots })).toBeUndefined();
    expect(parseAutoPathConsentEvidence({ scopeAudit: fourRoots.slice(0, 3) })?.roots).toEqual([
      '/a',
      '/b',
      '/c',
    ]);
  });

  it('ignores audits that were not authorized by the user message', () => {
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [entry({ scopeVerdict: 'primary', source: 'workspace' })],
      }),
    ).toBeUndefined();
    expect(
      parseAutoPathConsentEvidence({ scopeAudit: [entry({ source: 'user-approval' })] }),
    ).toBeUndefined();
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [entry({ scopeVerdict: 'grant:grant-1', source: 'user-approval' })],
      }),
    ).toBeUndefined();
  });

  it.each([
    ['a verdict bound to another operation', entry({ scopeVerdict: 'consent:op-other' })],
    ['a write mode the auto root can never carry', entry({ mode: 'write' })],
    ['a missing device id', entry({ deviceId: undefined })],
    ['a missing topic id', entry({ topicId: undefined })],
    ['a missing operation id', entry({ operationId: undefined })],
    ['an empty path', entry({ path: '' })],
    ['a missing source', entry({ source: undefined })],
    ['a runtime that never named the authorization root', entry({ rootPath: undefined })],
    ['a target that escapes its own root', entry({ path: '/home/me/other/a.txt' })],
    ['a root that is merely a string prefix of the target', entry({ path: '/home/me/docsx' })],
  ])('rejects %s', (_case, bad) => {
    expect(parseAutoPathConsentEvidence({ scopeAudit: [bad] })).toBeUndefined();
  });

  it('rejects an audit whose auto entries disagree with each other', () => {
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [
          entry(),
          entry({ deviceId: 'device-2', path: '/home/me/other', rootPath: '/home/me/other' }),
        ],
      }),
    ).toBeUndefined();
  });

  it('rejects a mixed audit rather than reporting a partial authorization', () => {
    expect(
      parseAutoPathConsentEvidence({
        scopeAudit: [
          entry(),
          entry({
            path: '/home/me/other',
            rootPath: '/home/me/other',
            scopeVerdict: 'consent:op-other',
          }),
        ],
      }),
    ).toBeUndefined();
  });

  it.each([
    ['no state', undefined],
    ['a non-object state', 'INTERVENTION_REQUIRED'],
    ['a state without an audit', { result: 'ok' }],
    ['an empty audit', { scopeAudit: [] }],
    ['a non-array audit', { scopeAudit: { path: '/home/me/docs' } }],
    ['a malformed entry alongside a good one', { scopeAudit: [entry(), null] }],
  ])('returns nothing for %s', (_case, state) => {
    expect(parseAutoPathConsentEvidence(state)).toBeUndefined();
  });

  it('never derives a root from tool arguments', () => {
    expect(
      parseAutoPathConsentEvidence({
        arguments: { path: '/etc/passwd' },
        result: { path: '/etc/passwd' },
      }),
    ).toBeUndefined();
  });
});
