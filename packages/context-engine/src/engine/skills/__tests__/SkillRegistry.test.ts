import type {
  ProjectWorkspaceSkillPolicy,
  SkillProvider,
  SkillProviderContext,
  SkillRef,
} from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it } from 'vitest';

import { OwnerOnlySkillVisibilityPolicy, SkillRegistry } from '../SkillRegistry';

const policy: ProjectWorkspaceSkillPolicy = {
  includeAgentSkills: true,
  includeProjectSkills: true,
  includeUserSkills: true,
};

const context: SkillProviderContext = {
  agentId: 'agent-1',
  skillPolicy: policy as SkillProviderContext['skillPolicy'],
  userId: 'user-1',
  workspace: { id: 'workspace-1', kind: 'device', rootPath: '/repo' },
};

const ref = (source: SkillRef['source'], name: string, ownerId?: string): SkillRef => ({
  description: `${source} ${name}`,
  identifier: `${source}-${name}`,
  key: `${source}:${name}`,
  name,
  ownerId,
  scope:
    source === 'builtin' ? 'builtin' : source === 'project' ? 'project' : 'personal',
  source,
});

const provider = (source: SkillProvider['source'], refs: SkillRef[]): SkillProvider => ({
  list: async () => refs,
  source,
});

describe('SkillRegistry', () => {
  it('uses stable project > user > agent > builtin precedence for name collisions', async () => {
    const registry = new SkillRegistry({
      providers: [
        provider('builtin', [ref('builtin', 'deploy')]),
        provider('agent', [ref('agent', 'deploy')]),
        provider('user', [ref('user', 'deploy')]),
        provider('project', [ref('project', 'deploy')]),
      ],
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills).toEqual([expect.objectContaining({ key: 'project:deploy' })]);
    expect(result.entries).toEqual([
      expect.objectContaining({ ref: expect.objectContaining({ key: 'project:deploy' }), status: 'available' }),
      expect.objectContaining({ shadowedBy: 'project:deploy', status: 'shadowed' }),
      expect.objectContaining({ shadowedBy: 'project:deploy', status: 'shadowed' }),
      expect.objectContaining({ shadowedBy: 'project:deploy', status: 'shadowed' }),
    ]);
  });

  it('lets a builtin surface when a colliding project source is disabled by policy', async () => {
    const registry = new SkillRegistry({
      providers: [
        provider('builtin', [ref('builtin', 'deploy')]),
        provider('project', [ref('project', 'deploy')]),
      ],
    });

    const result = await registry.resolve(
      {
        ...context,
        skillPolicy: { ...context.skillPolicy, includeProjectSkills: false },
      },
      { userId: 'user-1' },
    );

    expect(result.skills[0].key).toBe('builtin:deploy');
    expect(result.entries).toEqual([
      expect.objectContaining({ reason: 'policy', status: 'disabled' }),
      expect.objectContaining({ ref: expect.objectContaining({ key: 'builtin:deploy' }), status: 'available' }),
    ]);
  });

  it('injects visibility before collision resolution and never reports hidden refs', async () => {
    const registry = new SkillRegistry({
      providers: [
        provider('builtin', [ref('builtin', 'deploy')]),
        provider('user', [ref('user', 'deploy', 'another-user')]),
      ],
      visibilityPolicy: new OwnerOnlySkillVisibilityPolicy(),
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills.map(({ key }) => key)).toEqual(['builtin:deploy']);
    expect(result.entries.some(({ ref }) => ref.key === 'user:deploy')).toBe(false);
  });

  it('does not re-admit a hidden ref that collides with an authorized ref key and identifier', async () => {
    const visibleRef = {
      ...ref('user', 'deploy', 'user-1'),
      content: 'authorized content',
      identifier: 'shared-identifier',
      key: 'shared-key',
    };
    const hiddenRef = {
      ...ref('project', 'deploy', 'another-workspace'),
      content: 'hidden content',
      identifier: 'shared-identifier',
      key: 'shared-key',
    };
    const registry = new SkillRegistry({
      providers: [
        provider('project', [hiddenRef]),
        provider('user', [visibleRef]),
      ],
      visibilityPolicy: { filter: async () => [visibleRef] },
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills).toEqual([visibleRef]);
    expect(result.entries).toEqual([{ ref: visibleRef, status: 'available' }]);
    expect(result.entries.some(({ ref }) => ref.content === 'hidden content')).toBe(false);
  });

  it('rejects cloned refs returned by visibility while providers resolve concurrently', async () => {
    const first = ref('builtin', 'artifacts');
    const second = ref('user', 'deploy', 'user-1');
    const registry = new SkillRegistry({
      providers: [
        {
          list: async () => {
            await Promise.resolve();
            return [first];
          },
          source: 'builtin',
        },
        {
          list: async () => {
            await Promise.resolve();
            return [second];
          },
          source: 'user',
        },
      ],
      visibilityPolicy: { filter: async (refs) => refs.map((candidate) => ({ ...candidate })) },
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  it('isolates provider failures and records policy evidence in the operation trace', async () => {
    const failing: SkillProvider = {
      list: async () => {
        throw new Error('project device is offline');
      },
      source: 'project',
    };
    const registry = new SkillRegistry({
      providers: [failing, provider('builtin', [ref('builtin', 'artifacts')])],
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills.map(({ key }) => key)).toEqual(['builtin:artifacts']);
    expect(result.errors).toEqual([{ message: 'project device is offline', source: 'project' }]);
    expect(result.policy.materializeForHeteroCli).toBe('off');
  });

  it('fails closed when the visibility policy fails', async () => {
    const registry = new SkillRegistry({
      providers: [provider('builtin', [ref('builtin', 'artifacts')])],
      visibilityPolicy: {
        filter: async () => {
          throw new Error('ACL unavailable');
        },
      },
    });

    const result = await registry.resolve(context, { userId: 'user-1' });

    expect(result.skills).toEqual([]);
    expect(result.errors).toContainEqual({ message: 'ACL unavailable', source: 'visibility' });
  });
});
