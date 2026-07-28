import { describe, expect, it, vi } from 'vitest';

import type { OAuthHandoffItem } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { OAuthHandoffModel } from '../oauthHandoff';

describe('OAuthHandoffModel atomic consumption', () => {
  it('returns a handoff only for the delete call that consumed it', async () => {
    const handoff = {
      accessedAt: new Date(),
      client: 'desktop',
      createdAt: new Date(),
      id: 'handoff-1',
      payload: { code: 'auth-code', state: 'handoff-1' },
      updatedAt: new Date(),
    } as OAuthHandoffItem;
    const returning = vi.fn().mockResolvedValueOnce([handoff]).mockResolvedValueOnce([]);
    const where = vi.fn(() => ({ returning }));
    const deleteFrom = vi.fn(() => ({ where }));
    const db = { delete: deleteFrom } as unknown as LobeChatDatabase;
    const model = new OAuthHandoffModel(db);

    await expect(model.fetchAndConsume('handoff-1', 'desktop')).resolves.toEqual(handoff);
    await expect(model.fetchAndConsume('handoff-1', 'desktop')).resolves.toBeNull();

    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
    expect(returning).toHaveBeenCalledTimes(2);
  });
});
