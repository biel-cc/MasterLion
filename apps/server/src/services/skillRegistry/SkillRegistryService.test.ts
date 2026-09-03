// @vitest-environment node
import type { SkillProviderContext } from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it } from 'vitest';

import {
  createBuiltinSkillProvider,
  createProjectSkillProvider,
  createUserSkillProvider,
} from './providers';
import { SkillRegistryService } from './SkillRegistryService';

const context: SkillProviderContext = {
  agentId: 'agent-1',
  skillPolicy: {
    includeAgentSkills: true,
    includeProjectSkills: true,
    includeUserSkills: true,
  },
  userId: 'user-1',
  workspace: { id: 'workspace-1', kind: 'device', rootPath: '/repo' },
  workspaceInit: {
    instructions: [],
    skills: [{ description: 'project deploy', name: 'Deploy', path: '/repo/.agents/skills/deploy/SKILL.md' }],
  },
};

describe('SkillRegistryService', () => {
  it('combines providers and activates the same precedence winner exposed to prompts', async () => {
    const service = new SkillRegistryService({
      providers: [
        createBuiltinSkillProvider([
          {
            content: 'builtin deploy',
            description: 'builtin deploy',
            identifier: 'builtin-deploy',
            name: 'Deploy',
            source: 'builtin',
          },
        ]),
        createUserSkillProvider(async () => [
          { description: 'user deploy', identifier: 'user-deploy', name: 'Deploy' },
        ]),
        createProjectSkillProvider(),
      ],
    });

    const { ref, result } = await service.activate('Deploy', context, {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(ref).toMatchObject({ location: expect.stringContaining('SKILL.md'), source: 'project' });
    expect(result.skills).toHaveLength(1);
    expect(result.entries.map(({ status }) => status)).toEqual([
      'available',
      'shadowed',
      'shadowed',
    ]);
  });

  it('does not expose another workspace project skill through owner-only visibility', async () => {
    const service = new SkillRegistryService({ providers: [createProjectSkillProvider()] });

    const result = await service.resolve(context, {
      userId: 'user-1',
      workspaceId: 'workspace-2',
    });

    expect(result.skills).toEqual([]);
    expect(result.entries).toEqual([]);
  });
});
