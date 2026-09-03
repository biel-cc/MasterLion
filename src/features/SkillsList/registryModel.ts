import type { SkillRegistryResult } from '@lobechat/context-engine';

import type { SkillListItem } from './SkillsList';

export type SkillRegistryErrorCode = 'providerUnavailable' | 'visibilityUnavailable';
export type SkillRegistryReasonCode = 'policyDisabled' | 'precedenceShadowed';

export interface SkillRegistryListModel {
  errors: Array<{
    code: SkillRegistryErrorCode;
    source: SkillRegistryResult['errors'][number]['source'];
  }>;
  items: SkillListItem[];
  materialization: SkillRegistryResult['policy']['materializeForHeteroCli'];
}

/** Safe UI projection: diagnostics expose stable codes and canonical enums, never raw errors. */
export const toSkillRegistryListModel = (
  result: SkillRegistryResult,
): SkillRegistryListModel => ({
  errors: result.errors.map(({ source }) => ({
    code: source === 'visibility' ? 'visibilityUnavailable' : 'providerUnavailable',
    source,
  })),
  items: result.entries.map(({ reason, ref, status }) => ({
    description: ref.description,
    id: ref.key,
    name: ref.name,
    reasonCode:
      reason === 'policy'
        ? 'policyDisabled'
        : reason === 'precedence'
          ? 'precedenceShadowed'
          : undefined,
    scope: ref.scope,
    source: ref.source,
    status,
  })),
  materialization: result.policy.materializeForHeteroCli,
});
