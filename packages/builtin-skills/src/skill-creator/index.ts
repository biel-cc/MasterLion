import type { BuiltinSkill } from '@lobechat/types';

import content from './SKILL.md';

export const SkillCreatorIdentifier = 'skill-creator';

export const SkillCreatorSkill: BuiltinSkill = {
  avatar: '🧰',
  content,
  description:
    'Create or revise a safe project skill when the user asks to author reusable instructions, scripts, or references.',
  identifier: SkillCreatorIdentifier,
  name: SkillCreatorIdentifier,
  source: 'builtin',
  title: 'Skill Creator',
};
