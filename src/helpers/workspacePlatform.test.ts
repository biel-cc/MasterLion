import { describe, expect, it } from 'vitest';

import { normalizeNewTopicIntent } from './workspacePlatform';

describe('new topic platform boundary', () => {
  it('removes a stale desktop directory from a Web draft', () => {
    expect(
      normalizeNewTopicIntent(
        {
          target: 'local',
          targetDeviceId: 'desktop',
          workspaceId: 'project',
          legacyWorkingDirectory: '/repo',
          runtimeEditable: true,
        },
        false,
      ),
    ).toMatchObject({
      target: 'none',
      workspaceId: undefined,
      targetDeviceId: undefined,
      legacyWorkingDirectory: undefined,
    });
  });
  it('keeps an explicit Web gateway choice and reference', () => {
    expect(
      normalizeNewTopicIntent(
        { target: 'device', targetDeviceId: 'remote', referenceTopicId: 'old' },
        false,
      ),
    ).toMatchObject({ target: 'device', targetDeviceId: 'remote', referenceTopicId: 'old' });
  });
  it('preserves desktop drafts without changing their identity', () => {
    const draft = { target: 'local' as const, workspaceId: 'project', runtimeEditable: true };
    expect(normalizeNewTopicIntent(draft, true)).toBe(draft);
  });
});
