import { describe, expect, it } from 'vitest';

import { type SkillItem, skillPrompt, skillsPrompts } from './index';

describe('skillPrompt', () => {
  it('should generate skill tag with location', () => {
    const skill: SkillItem = {
      description: 'Extracts text and tables from PDF files',
      identifier: 'pdf-processing',
      location: '/path/to/skills/pdf-processing/SKILL.md',
      name: 'PDF Processing',
    };

    expect(skillPrompt(skill)).toBe(
      '  <skill name="PDF Processing" identifier="pdf-processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>',
    );
  });

  it('should generate skill tag without location', () => {
    const skill: SkillItem = {
      description: 'Custom skill description',
      identifier: 'my-skill',
      name: 'My Skill',
    };

    expect(skillPrompt(skill)).toBe(
      '  <skill name="My Skill" identifier="my-skill">Custom skill description</skill>',
    );
  });
});

describe('skillsPrompts', () => {
  it('should generate available_skills block with multiple skills', () => {
    const skills: SkillItem[] = [
      {
        description: 'Extracts text and tables from PDF files',
        identifier: 'pdf-processing',
        location: '/path/to/skills/pdf-processing/SKILL.md',
        name: 'PDF Processing',
      },
      {
        description: 'Analyzes datasets and generates charts',
        identifier: 'data-analysis',
        location: '/path/to/skills/data-analysis/SKILL.md',
        name: 'Data Analysis',
      },
    ];

    const expected = `<available_skills>
  <skill name="PDF Processing" identifier="pdf-processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>
  <skill name="Data Analysis" identifier="data-analysis" location="/path/to/skills/data-analysis/SKILL.md">Analyzes datasets and generates charts</skill>
</available_skills>

Use the activateSkill tool with the exact skill name to load its instructions.`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should generate mixed skills with and without location', () => {
    const skills: SkillItem[] = [
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        location: '/path/to/skills/artifacts/SKILL.md',
        name: 'Artifacts',
      },
      {
        description: 'Custom skill description',
        identifier: 'my-skill',
        name: 'My Skill',
      },
    ];

    const expected = `<available_skills>
  <skill name="Artifacts" identifier="artifacts" location="/path/to/skills/artifacts/SKILL.md">Generate interactive UI components</skill>
  <skill name="My Skill" identifier="my-skill">Custom skill description</skill>
</available_skills>

Use the activateSkill tool with the exact skill name to load its instructions.`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should return empty string for empty skills array', () => {
    expect(skillsPrompts([])).toBe('');
  });

  it('escapes registry metadata and descriptions as XML', () => {
    expect(
      skillPrompt({
        description: 'Use A & B <safely>',
        identifier: 'unsafe-id',
        key: 'user:unsafe-id',
        name: 'A "quoted" skill',
        scope: 'personal',
        source: 'user',
      }),
    ).toBe(
      '  <skill name="A &quot;quoted&quot; skill" identifier="unsafe-id" key="user:unsafe-id" source="user" scope="personal">Use A &amp; B &lt;safely&gt;</skill>',
    );
  });
});
