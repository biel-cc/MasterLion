import type {
  SkillScope as CanonicalSkillScope,
  SkillSourceKind,
} from '@lobechat/types/src/projectWorkspace';

export { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

export type SkillScope = CanonicalSkillScope;
export type SkillSource = SkillSourceKind;

export interface SkillItem {
  description: string;
  identifier: string;
  /** Stable registry key used for diagnostics. */
  key?: string;
  location?: string;
  name: string;
  scope?: SkillScope;
  /**
   * Where the skill comes from. `project` skills live on the device filesystem
   * (e.g. `.agents/skills/<name>/SKILL.md`) and `location` carries their absolute
   * path so the model can load them via the readFile tool.
   */
  source?: SkillSource;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export const skillPrompt = (skill: SkillItem) => {
  const attrs = [`name="${escapeXml(skill.name)}"`];
  if (skill.identifier !== skill.name) attrs.push(`identifier="${escapeXml(skill.identifier)}"`);
  if (skill.key) attrs.push(`key="${escapeXml(skill.key)}"`);
  if (skill.source) attrs.push(`source="${skill.source}"`);
  if (skill.scope) attrs.push(`scope="${skill.scope}"`);
  if (skill.location) attrs.push(`location="${escapeXml(skill.location)}"`);
  return `  <skill ${attrs.join(' ')}>${escapeXml(skill.description)}</skill>`;
};

export const skillsPrompts = (skills: SkillItem[]) => {
  if (skills.length === 0) return '';

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');

  return `<available_skills>
${skillTags}
</available_skills>

Use the activateSkill tool with the exact skill name to load its instructions.`;
};
