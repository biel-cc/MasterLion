import type { BuiltinSkill } from '@lobechat/types';
import type {
  SkillProvider,
  SkillProviderContext,
  SkillRef,
} from '@lobechat/types/src/projectWorkspace';

export interface RegistrySourceSkill {
  content?: string;
  description?: string | null;
  identifier: string;
  location?: string;
  name: string;
  ownerId?: string;
  zipFileHash?: string | null;
}

type RegistrySourceLoader = (context: SkillProviderContext) => Promise<RegistrySourceSkill[]>;

export const createBuiltinSkillProvider = (skills: readonly BuiltinSkill[]): SkillProvider => ({
  list: async () =>
    skills.map((skill) => ({
      content: skill.content,
      description: skill.description,
      identifier: skill.identifier,
      key: `builtin:${skill.identifier}`,
      name: skill.name,
      scope: 'builtin',
      source: 'builtin',
    })),
  source: 'builtin',
});

export const createUserSkillProvider = (load: RegistrySourceLoader): SkillProvider => ({
  list: async (context) =>
    (await load(context)).map<SkillRef>((skill) => ({
      content: skill.content,
      description: skill.description ?? '',
      identifier: skill.identifier,
      key: `user:${skill.identifier}`,
      name: skill.name,
      ownerId: skill.ownerId ?? context.userId,
      scope: 'personal',
      source: 'user',
      zipFileHash: skill.zipFileHash,
    })),
  source: 'user',
});

export const createAgentSkillProvider = (load: RegistrySourceLoader): SkillProvider => ({
  list: async (context) =>
    (await load(context)).map<SkillRef>((skill) => ({
      content: skill.content,
      description: skill.description ?? '',
      identifier: skill.identifier,
      key: `agent:${skill.identifier}`,
      name: skill.name,
      ownerId: skill.ownerId ?? context.userId,
      scope: 'personal',
      source: 'agent',
    })),
  source: 'agent',
});

export const createProjectSkillProvider = (): SkillProvider => ({
  list: async (context) => {
    if (!context.workspace) return [];
    const ownerId = context.workspace.id ?? context.userId;

    return (context.workspaceInit?.skills ?? []).map<SkillRef>((skill) => ({
      description: skill.description ?? '',
      identifier: `project:${skill.name}`,
      key: `project:${ownerId}:${skill.name}`,
      location: skill.path,
      name: skill.name,
      ownerId,
      scope: 'project',
      source: 'project',
    }));
  },
  source: 'project',
});
