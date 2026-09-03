import {
  CredsIdentifier,
  type CredSummary,
  injectCredsContext,
  type UserCredsContext,
} from '@lobechat/builtin-tool-creds';
import { SkillRegistry, type SkillRegistryResult } from '@lobechat/context-engine';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { SkillItem, UserCredSummary } from '@lobechat/types';
import type {
  ProjectWorkspaceSkillPolicy,
  SkillProvider,
  SkillRef,
} from '@lobechat/types/src/projectWorkspace';
import debug from 'debug';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

const log = debug('context-engine:client-skill-registry');

const buildDbSkillContent = (detail: SkillItem): string | undefined => {
  if (!detail.content) return undefined;
  if (!detail.resources || Object.keys(detail.resources).length === 0) return detail.content;
  return detail.content + '\n\n' + resourcesTreePrompt(detail.name, detail.resources);
};

const buildCredsContext = (userCreds?: UserCredSummary[]): UserCredsContext => ({
  creds: (userCreds || []).map<CredSummary>((cred) => ({
    description: cred.description,
    key: cred.key,
    name: cred.name,
    type: cred.type,
  })),
  settingsUrl: '/settings/creds',
});

export interface ResolveClientSkillRegistryOptions {
  contentIdentifiers?: string[];
  policy?: ProjectWorkspaceSkillPolicy;
  userCreds?: UserCredSummary[];
}

/** Client projection of the shared registry used by both prompt assembly and selected skills. */
export const resolveClientSkillRegistry = async (
  options: ResolveClientSkillRegistryOptions = {},
): Promise<SkillRegistryResult> => {
  const toolState = getToolStoreState();
  const requested = new Set(options.contentIdentifiers ?? []);

  const builtinProvider: SkillProvider = {
    list: async () =>
      (toolState.builtinSkills || []).map<SkillRef>((skill) => ({
        content:
          skill.identifier === CredsIdentifier
            ? injectCredsContext(skill.content, buildCredsContext(options.userCreds))
            : skill.content,
        description: skill.description,
        identifier: skill.identifier,
        key: `builtin:${skill.identifier}`,
        name: skill.name,
        scope: 'builtin',
        source: 'builtin',
      })),
    source: 'builtin',
  };

  const userProvider: SkillProvider = {
    list: async () => {
      const listItems = [...(toolState.agentSkills || [])];
      const knownIds = new Set(listItems.map(({ identifier }) => identifier));

      const extraDetails = await Promise.all(
        [...requested]
          .filter((identifier) => !knownIds.has(identifier))
          .map(async (identifier) => {
            try {
              return await agentSkillService.getByIdentifier(identifier);
            } catch (error) {
              log('Failed to resolve selected skill %s: %O', identifier, error);
              return undefined;
            }
          }),
      );

      const refs: SkillRef[] = [];
      for (const item of listItems) {
        let content: string | undefined;
        if (requested.has(item.identifier) && !item.zipFileHash) {
          try {
            const detail =
              toolState.agentSkillDetailMap?.[item.id] ??
              (await agentSkillService.getById(item.id));
            if (detail) content = buildDbSkillContent(detail);
          } catch (error) {
            log('Failed to load selected skill content %s: %O', item.identifier, error);
          }
        }

        refs.push({
          content,
          description: item.description ?? '',
          identifier: item.identifier,
          key: `user:${item.identifier}`,
          name: item.name,
          ownerId: 'client-user',
          scope: 'personal',
          source: 'user',
          zipFileHash: item.zipFileHash,
        });
      }

      for (const detail of extraDetails) {
        if (!detail) continue;
        refs.push({
          content: detail.zipFileHash ? undefined : buildDbSkillContent(detail),
          description: detail.description ?? '',
          identifier: detail.identifier,
          key: `user:${detail.identifier}`,
          name: detail.name,
          ownerId: 'client-user',
          scope: 'personal',
          source: 'user',
          zipFileHash: detail.zipFileHash,
        });
      }

      return refs;
    },
    source: 'user',
  };

  const registry = new SkillRegistry({ providers: [builtinProvider, userProvider] });
  const policy = {
    includeAgentSkills: true,
    includeProjectSkills: true,
    includeUserSkills: true,
    ...options.policy,
  };

  return registry.resolve(
    {
      agentId: 'client-agent',
      skillPolicy: policy,
      userId: 'client-user',
    },
    { userId: 'client-user' },
  );
};
