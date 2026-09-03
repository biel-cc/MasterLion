import type { WorkspaceInitResult } from '../device';
import type { WorkspaceRef } from './index';

export type SkillSourceKind = 'agent' | 'builtin' | 'project' | 'user' | 'workspace';

/**
 * Distribution scope. Team and company are reserved extension points; the v2
 * workspace runtime only produces builtin, personal, and project skills.
 */
export type SkillScope = 'builtin' | 'company' | 'personal' | 'project' | 'team';

export interface SkillRef {
  /** Inline content when the provider can supply it cheaply. */
  content?: string;
  description: string;
  /** Existing public identifier. Workspace Runtime must not rewrite it. */
  identifier: string;
  /** Stable registry key: `<source>:<identifier>`. */
  key: string;
  /** Absolute SKILL.md path for filesystem-backed project skills. */
  location?: string;
  /** activateSkill lookup key; precedence resolves collisions. */
  name: string;
  /** Owning user, agent, workspace, team, or company when applicable. */
  ownerId?: string;
  scope: SkillScope;
  source: SkillSourceKind;
  /** Bundle hash for zip-backed user skills. */
  zipFileHash?: string | null;
}

export interface ProjectWorkspaceSkillPolicy {
  includeAgentSkills?: boolean;
  includeProjectSkills?: boolean;
  includeUserSkills?: boolean;
  materializeForHeteroCli?: 'off' | 'project' | 'user';
  pinned?: string[];
}

export interface SkillProviderContext {
  agentId: string;
  skillPolicy: Required<
    Pick<
      ProjectWorkspaceSkillPolicy,
      'includeAgentSkills' | 'includeProjectSkills' | 'includeUserSkills'
    >
  > &
    ProjectWorkspaceSkillPolicy;
  userId: string;
  workspace?: WorkspaceRef;
  workspaceInit?: WorkspaceInitResult;
}

/** Source adapter consumed by the future registry; it does not define registry behavior. */
export interface SkillProvider {
  list: (context: SkillProviderContext) => Promise<SkillRef[]>;
  source: SkillSourceKind;
}

export interface SkillVisibilityPrincipal {
  departmentIds?: string[];
  userId: string;
  workspaceId?: string | null;
}

/** Visibility adapter. The owner-only/ACL implementations belong to the Skill lane. */
export interface SkillVisibilityPolicy {
  filter: (refs: SkillRef[], principal: SkillVisibilityPrincipal) => Promise<SkillRef[]>;
}
