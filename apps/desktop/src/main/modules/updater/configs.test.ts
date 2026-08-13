import { describe, expect, it, vi } from 'vitest';

import { resolveInitialUpdateChannel } from './configs';

vi.mock('@/const/env', () => ({ isDev: false }));
vi.mock('@/env', () => ({
  getDesktopEnv: () => ({
    DISABLE_APP_UPDATE: false,
    UPDATE_CHANNEL: 'canary',
    UPDATE_SERVER_URL: 'https://updates.example.com',
  }),
}));

describe('resolveInitialUpdateChannel', () => {
  it('keeps unsigned canary builds on canary when an older build stored stable', () => {
    expect(resolveInitialUpdateChannel('stable', 'canary')).toBe('canary');
  });

  it('preserves a selected channel for stable builds', () => {
    expect(resolveInitialUpdateChannel('canary', 'stable')).toBe('canary');
    expect(resolveInitialUpdateChannel('stable', 'stable')).toBe('stable');
  });

  it('normalizes legacy channel values for stable builds', () => {
    expect(resolveInitialUpdateChannel('nightly', 'stable')).toBe('stable');
  });
});
