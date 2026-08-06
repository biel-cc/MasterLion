import { describe, expect, it } from 'vitest';

import { builtinSkills, OfficeDocumentsIdentifier } from './index';

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
