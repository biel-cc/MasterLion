import { describe, expect, it } from 'vitest';
import { refreshedDefaultAgent } from './model-settings.mjs';

describe('explicit development model refresh', () => {
  it('changes the ordinary agent model while retaining unrelated user settings', () => {
    const previous = {
      meta: { title: 'My defaults' },
      config: {
        model: 'old-model',
        provider: 'old-provider',
        systemRole: 'Keep my prompt',
        params: { temperature: 0.4 },
      },
    };
    expect(refreshedDefaultAgent(previous, { model: 'new-model', provider: 'newapi' })).toEqual({
      ...previous,
      config: { ...previous.config, model: 'new-model', provider: 'newapi' },
    });
    expect(previous.config.model).toBe('old-model');
  });
  it('initializes missing or null default agent configuration', () => {
    for (const value of [undefined, null, {}, { config: null }])
      expect(refreshedDefaultAgent(value, { model: 'new-model', provider: 'newapi' })).toEqual({
        config: { model: 'new-model', provider: 'newapi' },
      });
  });
});
