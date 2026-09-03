import type { RuntimeSelectedSkill, UserCredSummary } from '@lobechat/types';

import { resolveClientSkillRegistry } from './clientSkillRegistry';

interface PrepareSelectedSkillPreloadParams {
  message: string;
  selectedSkills?: RuntimeSelectedSkill[];
  /**
   * User credentials for creds skill injection
   */
  userCreds?: UserCredSummary[];
}

// Match <skill name="..." label="..." /> and legacy <action type="..." category="skill" ... />
const SKILL_TAG_REGEX = /<skill\b([^>]*)\/>/g;
const LEGACY_ACTION_TAG_REGEX = /<action\b([^>]*)\/>/g;

const getAttr = (attrs: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
};

const extractSelectedSkillsFromText = (text: string): RuntimeSelectedSkill[] => {
  const parsedSkills: RuntimeSelectedSkill[] = [];

  // New format: <skill name="..." label="..." />
  for (const match of text.matchAll(SKILL_TAG_REGEX)) {
    const attrs = match[1] || '';
    const identifier = getAttr(attrs, 'name');
    if (!identifier) continue;
    parsedSkills.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  // Legacy format: <action type="..." category="skill" label="..." />
  for (const match of text.matchAll(LEGACY_ACTION_TAG_REGEX)) {
    const attrs = match[1] || '';
    if (getAttr(attrs, 'category') !== 'skill') continue;
    const identifier = getAttr(attrs, 'type');
    if (!identifier) continue;
    parsedSkills.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  return parsedSkills;
};

const resolveSelectedSkills = (
  message: string,
  selectedSkills?: RuntimeSelectedSkill[],
): RuntimeSelectedSkill[] => {
  const mergedSkills = [...(selectedSkills || []), ...extractSelectedSkillsFromText(message)];
  const seen = new Set<string>();

  return mergedSkills.reduce<RuntimeSelectedSkill[]>((acc, skill) => {
    if (!skill.identifier || seen.has(skill.identifier)) return acc;

    seen.add(skill.identifier);
    acc.push(skill);
    return acc;
  }, []);
};

/**
 * Enrich selected skills with preloaded content from skill store.
 * Skills with available content get it attached directly, enabling
 * SelectedSkillInjector to inline the content into the user message
 * instead of constructing fake activateSkill tool-call preload messages.
 */
export const resolveSelectedSkillsWithContent = async ({
  message,
  selectedSkills,
  userCreds,
}: PrepareSelectedSkillPreloadParams): Promise<RuntimeSelectedSkill[]> => {
  const resolved = resolveSelectedSkills(message, selectedSkills);

  if (resolved.length === 0) return [];

  const registry = await resolveClientSkillRegistry({
    contentIdentifiers: resolved.map(({ identifier }) => identifier),
    userCreds,
  });
  const byIdentifier = new Map(registry.skills.map((skill) => [skill.identifier, skill]));

  return resolved.map((skill) => {
    const registered = byIdentifier.get(skill.identifier);
    if (!registered) return skill;
    return {
      ...skill,
      ...(registered.content && { content: registered.content }),
      // Registry name is the exact activateSkill lookup key; UI labels are not.
      name: registered.name,
    };
  });
};
