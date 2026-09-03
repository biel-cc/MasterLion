import type { SkillRegistryResult } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { toSkillRegistryListModel } from './registryModel';

const defaultResult = (): SkillRegistryResult => ({
  entries: [],
  errors: [],
  policy: {
    includeAgentSkills: true,
    includeProjectSkills: false,
    includeUserSkills: true,
    materializeForHeteroCli: 'off',
    pinned: [],
  },
  precedence: { agent: 200, builtin: 100, project: 400, user: 300, workspace: 350 },
  skills: [],
});

describe('toSkillRegistryListModel', () => {
  it('projects only stable codes and safe enums from registry diagnostics', () => {
    const result: SkillRegistryResult = {
      ...defaultResult(),
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
      errors: [
        {
          message: 'failed at /private/workspace/.agents/skills: personal skills unavailable',
          source: 'user',
        },
        { message: 'ACL backend disclosed an internal failure', source: 'visibility' },
      ],
    };

    expect(toSkillRegistryListModel(result)).toEqual({
      errors: [
        { code: 'providerUnavailable', source: 'user' },
        { code: 'visibilityUnavailable', source: 'visibility' },
      ],
      items: [
        expect.objectContaining({
          reasonCode: 'policyDisabled',
          scope: 'project',
          source: 'project',
          status: 'disabled',
        }),
      ],
      materialization: 'off',
    });

    const serialized = JSON.stringify(toSkillRegistryListModel(result));
    expect(serialized).not.toContain('personal skills unavailable');
    expect(serialized).not.toContain('/private/workspace');
    expect(serialized).not.toContain('ACL backend');
  });

  it('does not expose the shadowing registry key in a precedence reason', () => {
    const result: SkillRegistryResult = {
      ...defaultResult(),
      entries: [
        {
          reason: 'precedence',
          ref: {
            description: 'Agent deployment',
            identifier: 'deploy',
            key: 'agent:secret-agent-id:deploy',
            name: 'deploy',
            ownerId: 'secret-agent-id',
            scope: 'personal',
            source: 'agent',
          },
          shadowedBy: 'project:/private/workspace:deploy',
          status: 'shadowed',
        },
      ],
    };

    const model = toSkillRegistryListModel(result);

    expect(model.items[0].reasonCode).toBe('precedenceShadowed');
    expect(JSON.stringify(model)).not.toContain('project:/private/workspace:deploy');
  });
});
