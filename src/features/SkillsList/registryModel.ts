import type { SkillRegistryResult } from '@lobechat/context-engine';

import type { SkillListItem } from './SkillsList';

export interface SkillRegistryListModel {
  errors: string[];
  items: SkillListItem[];
  materialization: SkillRegistryResult['policy']['materializeForHeteroCli'];
}

/** UI projection that keeps source, scope, disabled state, and registry errors understandable. */
export const toSkillRegistryListModel = (
  result: SkillRegistryResult,
): SkillRegistryListModel => ({
  errors: result.errors.map(({ message, source }) => `${source}: ${message}`),
  items: result.entries.map(({ reason, ref, shadowedBy, status }) => ({
    description: ref.description,
    disabledReason:
      reason === 'policy'
        ? `Disabled by project skill policy (${ref.source})`
        : reason === 'precedence'
          ? `Hidden by higher-precedence skill ${shadowedBy}`
          : undefined,
    id: ref.key,
    name: ref.name,
    scope: ref.scope,
    source: ref.source,
    status,
  })),
  materialization: result.policy.materializeForHeteroCli,
});
