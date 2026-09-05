import type { ExecScriptActivatedSkill } from './types';
import { SkillsIdentifier } from './types';

interface ActivationMessage {
  error?: unknown;
  plugin?: { apiName?: string; identifier?: string } | null;
  pluginState?: unknown;
  role: string;
}

/** Use persisted successful activations, ordered by their latest occurrence. */
export function selectActivatedSkillsFromMessages(
  messages: ActivationMessage[],
): ExecScriptActivatedSkill[] | undefined {
  const skills = new Map<string, ExecScriptActivatedSkill>();
  const add = (value: unknown) => {
    if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value)) return;
    if (typeof value.id !== 'string' || typeof value.name !== 'string') return;
    skills.delete(value.id);
    skills.set(value.id, {
      id: value.id,
      name: value.name,
      description:
        'description' in value && typeof value.description === 'string'
          ? value.description
          : undefined,
    });
  };
  for (const message of messages) {
    if (
      message.role !== 'tool' ||
      message.error ||
      ![SkillsIdentifier, 'lobe-activator'].includes(message.plugin?.identifier ?? '')
    )
      continue;
    if (message.plugin?.apiName === 'activateSkill') add(message.pluginState);
    if (
      message.plugin?.apiName === 'activateTools' &&
      message.pluginState &&
      typeof message.pluginState === 'object' &&
      'activatedSkills' in message.pluginState &&
      Array.isArray(message.pluginState.activatedSkills)
    ) {
      for (const skill of message.pluginState.activatedSkills) add(skill);
    }
  }
  return skills.size ? [...skills.values()] : undefined;
}
