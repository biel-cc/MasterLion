import type { SkillRegistryResult } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { toSkillRegistryListModel } from './registryModel';

describe('toSkillRegistryListModel', () => {
  it('projects source, scope, policy-disabled state, and errors from one registry result', () => {
    const result: SkillRegistryResult = {
      entries: [
        {
          reason: 'policy',
          ref: {
            description: 'Project deployment',
            identifier: 'project:deploy',
            key: 'project:workspace-1:deploy',
            name: 'deploy',
            ownerId: 'workspace-1',
            scope: 'project',
            source: 'project',
          },
          status: 'disabled',
        },
      ],
      errors: [{ message: 'personal skills unavailable', source: 'user' }],
      policy: {
        includeAgentSkills: true,
        includeProjectSkills: false,
        includeUserSkills: true,
        materializeForHeteroCli: 'off',
        pinned: [],
      },
      precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
      skills: [],
    };

    expect(toSkillRegistryListModel(result)).toEqual({
      errors: ['user: personal skills unavailable'],
      items: [
        expect.objectContaining({
          disabledReason: 'Disabled by project skill policy (project)',
          scope: 'project',
          source: 'project',
          status: 'disabled',
        }),
      ],
      materialization: 'off',
    });
  });
});
