import type { SkillScope, SkillSourceKind } from '@lobechat/types/src/projectWorkspace';

import type { SkillRegistryErrorCode, SkillRegistryReasonCode } from './registryModel';

export interface SkillRegistryI18nDescriptor {
  defaultValue: string;
  key: string;
}

export const skillRegistryErrorI18n: Record<
  SkillRegistryErrorCode,
  SkillRegistryI18nDescriptor
> = {
  providerUnavailable: {
    defaultValue: 'A skill provider is unavailable',
    key: 'skills.registry.error.providerUnavailable',
  },
  visibilityUnavailable: {
    defaultValue: 'Skill visibility could not be verified',
    key: 'skills.registry.error.visibilityUnavailable',
  },
};

export const skillRegistryReasonI18n: Record<
  SkillRegistryReasonCode,
  SkillRegistryI18nDescriptor
> = {
  policyDisabled: {
    defaultValue: 'Disabled by the project skill policy',
    key: 'skills.registry.reason.policyDisabled',
  },
  precedenceShadowed: {
    defaultValue: 'Hidden by a higher-precedence skill',
    key: 'skills.registry.reason.precedenceShadowed',
  },
};

export const skillScopeI18n: Record<SkillScope, SkillRegistryI18nDescriptor> = {
  builtin: { defaultValue: 'Built-in', key: 'skills.registry.scope.builtin' },
  company: { defaultValue: 'Company', key: 'skills.registry.scope.company' },
  personal: { defaultValue: 'Personal', key: 'skills.registry.scope.personal' },
  project: { defaultValue: 'Project', key: 'skills.registry.scope.project' },
  team: { defaultValue: 'Team', key: 'skills.registry.scope.team' },
};

export const skillSourceI18n: Record<
  SkillSourceKind | 'visibility',
  SkillRegistryI18nDescriptor
> = {
  agent: { defaultValue: 'Agent', key: 'skills.registry.source.agent' },
  builtin: { defaultValue: 'Built-in', key: 'skills.registry.source.builtin' },
  project: { defaultValue: 'Project', key: 'skills.registry.source.project' },
  user: { defaultValue: 'User', key: 'skills.registry.source.user' },
  visibility: { defaultValue: 'Visibility', key: 'skills.registry.source.visibility' },
  workspace: { defaultValue: 'Workspace', key: 'skills.registry.source.workspace' },
};
