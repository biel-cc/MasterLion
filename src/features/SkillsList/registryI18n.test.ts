import { describe, expect, it } from 'vitest';

import {
  skillRegistryErrorI18n,
  skillRegistryReasonI18n,
  skillScopeI18n,
  skillSourceI18n,
} from './registryI18n';

describe('skill registry i18n descriptors', () => {
  it('maps every stable error and reason code to a translation key and default value', () => {
    expect(skillRegistryErrorI18n).toEqual({
      providerUnavailable: {
        defaultValue: 'A skill provider is unavailable',
        key: 'skills.registry.error.providerUnavailable',
      },
      visibilityUnavailable: {
        defaultValue: 'Skill visibility could not be verified',
        key: 'skills.registry.error.visibilityUnavailable',
      },
    });
    expect(skillRegistryReasonI18n).toEqual({
      policyDisabled: {
        defaultValue: 'Disabled by the project skill policy',
        key: 'skills.registry.reason.policyDisabled',
      },
      precedenceShadowed: {
        defaultValue: 'Hidden by a higher-precedence skill',
        key: 'skills.registry.reason.precedenceShadowed',
      },
    });
  });

  it('maps all canonical source and scope enums without dynamic raw labels', () => {
    expect(Object.keys(skillSourceI18n).sort()).toEqual([
      'agent',
      'builtin',
      'project',
      'user',
      'visibility',
      'workspace',
    ]);
    expect(Object.keys(skillScopeI18n).sort()).toEqual([
      'builtin',
      'company',
      'personal',
      'project',
      'team',
    ]);
    for (const descriptor of [...Object.values(skillSourceI18n), ...Object.values(skillScopeI18n)]) {
      expect(descriptor.key).toMatch(/^skills\.registry\.(?:source|scope)\./);
      expect(descriptor.defaultValue).not.toBe('');
    }
  });
});
