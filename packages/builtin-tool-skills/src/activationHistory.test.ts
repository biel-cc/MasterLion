import { describe, expect, it } from 'vitest';

import { selectActivatedSkillsFromMessages } from './activationHistory';

describe('project activation history', () => {
  it('retains successful legacy project activations without trusting a path as an execution directory', () => {
    const activation = {
      plugin: { apiName: 'activateSkill', identifier: 'lobe-skills' },
      pluginState: {
        name: 'demo',
        source: 'project',
        location: '/project/.agents/skills/demo/SKILL.md',
      },
      role: 'tool',
    };
    expect(selectActivatedSkillsFromMessages([activation])).toEqual([
      { id: 'project:demo', name: 'demo' },
    ]);
    expect(
      selectActivatedSkillsFromMessages([{ ...activation, error: { message: 'failed' } }]),
    ).toBeUndefined();
    expect(
      selectActivatedSkillsFromMessages([
        { ...activation, pluginState: { name: 'demo', source: 'user' } },
      ]),
    ).toBeUndefined();
  });
});
