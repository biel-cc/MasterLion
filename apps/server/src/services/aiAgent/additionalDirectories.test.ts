import { describe, expect, it } from 'vitest';

import { buildAdditionalDirectoriesPrompt } from './additionalDirectories';

const now = new Date('2026-09-04T00:00:00.000Z');

describe('buildAdditionalDirectoriesPrompt', () => {
  it('injects normalized unique roots with modes and expiry but no authority identifiers', () => {
    const prompt = buildAdditionalDirectoriesPrompt(
      [
        {
          deviceId: 'device-secret',
          grantId: 'grant-secret',
          modes: ['write', 'read'],
          rootPath: '/code/shared/',
          scope: 'topic',
          source: 'user-approval',
          topicId: 'topic-secret',
        },
        {
          expiresAt: '2026-09-04T01:00:00.000Z',
          grantId: 'grant-other',
          modes: ['exec'],
          rootPath: '/code/temporary',
          scope: 'topic',
          source: 'user-approval',
        },
        {
          modes: ['read'],
          rootPath: '/code/shared',
          scope: 'topic',
          source: 'user-approval',
        },
      ],
      now,
    );

    expect(prompt).toContain(
      '<directory path="/code/shared" modes="read,write" scope="topic" />',
    );
    expect(prompt).toContain(
      '<directory path="/code/temporary" modes="exec" scope="topic" expires_at="2026-09-04T01:00:00.000Z" />',
    );
    expect(prompt).not.toMatch(/device-secret|grant-secret|topic-secret/);
    expect(prompt?.match(/path="\/code\/shared"/g)).toHaveLength(1);
  });

  it('omits unapproved direct-message candidates, expired grants, and invalid roots', () => {
    expect(
      buildAdditionalDirectoriesPrompt(
        [
          {
            modes: ['read'],
            rootPath: '/mentioned/not-approved',
            scope: 'operation',
            source: 'direct-user-message',
          },
          {
            expiresAt: '2026-09-03T23:59:59.000Z',
            modes: ['exec'],
            rootPath: '/expired',
            scope: 'topic',
            source: 'user-approval',
          },
          {
            modes: ['read'],
            rootPath: 'relative/path',
            scope: 'topic',
            source: 'user-approval',
          },
        ],
        now,
      ),
    ).toBeUndefined();
  });

  it('escapes path values before placing them in XML attributes', () => {
    expect(
      buildAdditionalDirectoriesPrompt(
        [
          {
            modes: ['read'],
            rootPath: '/code/a&b"c',
            scope: 'topic',
            source: 'user-approval',
          },
        ],
        now,
      ),
    ).toContain('path="/code/a&amp;b&quot;c"');
  });
});
