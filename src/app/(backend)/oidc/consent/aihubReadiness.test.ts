// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { scheduleAihubReadinessAfterOidcAuthorization } from './aihubReadiness';

describe('scheduleAihubReadinessAfterOidcAuthorization', () => {
  it('schedules readiness for every accepted OIDC authorization', async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const callbacks: Array<() => unknown> = [];
    const schedule = vi.fn((callback: () => unknown) => callbacks.push(callback));

    scheduleAihubReadinessAfterOidcAuthorization('user-1', {
      ensure: ensure as any,
      schedule: schedule as any,
    });

    expect(schedule).toHaveBeenCalledOnce();
    await callbacks[0]?.();
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'oidc_authorized', userId: 'user-1' }),
    );
  });

  it('never blocks OIDC authorization when background scheduling is unavailable', () => {
    expect(() =>
      scheduleAihubReadinessAfterOidcAuthorization('user-1', {
        ensure: vi.fn() as any,
        schedule: vi.fn(() => {
          throw new Error('outside request scope');
        }) as any,
      }),
    ).not.toThrow();
  });
});
