import { describe, expect, it } from 'vitest';

import { builtinSkills, OfficeDocumentsIdentifier, SkillCreatorIdentifier } from './index';

describe('OfficeDocumentsSkill', () => {
  it('registers the pinned Office workflow with format-specific references', () => {
    const skill = builtinSkills.find(({ identifier }) => identifier === OfficeDocumentsIdentifier);

    expect(skill?.content).toContain('OfficeCLI 1.0.143');
    expect(Object.keys(skill?.resources || {})).toEqual([
      'references/excel',
      'references/powerpoint',
      'references/word',
    ]);
  });
});

describe('SkillCreatorSkill', () => {
  it('self-hosts English authoring guidance with validation and promotion routing', () => {
    const skill = builtinSkills.find(({ identifier }) => identifier === SkillCreatorIdentifier);

    expect(skill).toMatchObject({ name: 'skill-creator', source: 'builtin' });
    expect(skill?.content).toContain('name: skill-creator');
    expect(skill?.content).toContain('lobe-skill-authoring');
    expect(skill?.content).toContain('validateProjectSkill');
    expect(skill?.content).toContain('promoteProjectSkill');
    expect(skill?.content).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
