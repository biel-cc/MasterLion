import type {
  ProjectWorkspaceSkillPolicy,
  SkillProvider,
  SkillProviderContext,
  SkillRef,
  SkillSourceKind,
  SkillVisibilityPolicy,
  SkillVisibilityPrincipal,
} from '@lobechat/types/src/projectWorkspace';

const DEFAULT_PRECEDENCE: Record<SkillSourceKind, number> = {
  agent: 200,
  builtin: 100,
  project: 400,
  user: 300,
  workspace: 350,
};

export const DEFAULT_SKILL_POLICY: Required<ProjectWorkspaceSkillPolicy> = {
  includeAgentSkills: true,
  includeProjectSkills: true,
  includeUserSkills: true,
  materializeForHeteroCli: 'off',
  pinned: [],
};

export type SkillRegistryEntryStatus = 'available' | 'disabled' | 'shadowed';

export interface SkillRegistryEntry {
  reason?: 'policy' | 'precedence';
  ref: SkillRef;
  shadowedBy?: string;
  status: SkillRegistryEntryStatus;
}

export interface SkillRegistryError {
  message: string;
  source: SkillSourceKind | 'visibility';
}

export interface SkillRegistryTrace {
  entries: SkillRegistryEntry[];
  errors: SkillRegistryError[];
  policy: Required<ProjectWorkspaceSkillPolicy>;
  precedence: Record<SkillSourceKind, number>;
}

export interface SkillRegistryResult extends SkillRegistryTrace {
  /** The single, deduplicated list consumed by prompts and activateSkill. */
  skills: SkillRef[];
}

export interface SkillRegistryOptions {
  precedence?: Partial<Record<SkillSourceKind, number>>;
  providers: SkillProvider[];
  visibilityPolicy?: SkillVisibilityPolicy;
}

const allowAllVisibility: SkillVisibilityPolicy = {
  filter: async (refs) => refs,
};

export const normalizeSkillPolicy = (
  policy?: ProjectWorkspaceSkillPolicy,
): Required<ProjectWorkspaceSkillPolicy> => ({
  ...DEFAULT_SKILL_POLICY,
  ...policy,
  pinned: [...(policy?.pinned ?? DEFAULT_SKILL_POLICY.pinned)],
});

const isEnabledByPolicy = (
  source: SkillSourceKind,
  policy: Required<ProjectWorkspaceSkillPolicy>,
): boolean => {
  switch (source) {
    case 'agent': {
      return policy.includeAgentSkills;
    }
    case 'project':
    case 'workspace': {
      return policy.includeProjectSkills;
    }
    case 'user': {
      return policy.includeUserSkills;
    }
    default: {
      return true;
    }
  }
};

/**
 * Merges every skill source behind one precedence, visibility, and project-policy boundary.
 * Provider failures are isolated and reported in the trace; visibility failures fail closed.
 */
export class SkillRegistry {
  private readonly precedence: Record<SkillSourceKind, number>;
  private readonly providers: SkillProvider[];
  private readonly visibilityPolicy: SkillVisibilityPolicy;

  constructor(options: SkillRegistryOptions) {
    this.providers = [...options.providers];
    this.precedence = { ...DEFAULT_PRECEDENCE, ...options.precedence };
    this.visibilityPolicy = options.visibilityPolicy ?? allowAllVisibility;
  }

  async resolve(
    context: SkillProviderContext,
    principal: SkillVisibilityPrincipal,
  ): Promise<SkillRegistryResult> {
    const policy = normalizeSkillPolicy(context.skillPolicy);
    const errors: SkillRegistryError[] = [];
    const candidates: Array<{ order: number; ref: SkillRef }> = [];

    await Promise.all(
      this.providers.map(async (provider, providerIndex) => {
        try {
          const refs = await provider.list({ ...context, skillPolicy: policy });
          refs.forEach((ref, itemIndex) => {
            if (ref.source !== provider.source) {
              errors.push({
                message: `Provider ${provider.source} returned a ${ref.source} skill (${ref.key}).`,
                source: provider.source,
              });
              return;
            }
            candidates.push({ order: providerIndex * 1_000_000 + itemIndex, ref });
          });
        } catch (error) {
          errors.push({
            message: error instanceof Error ? error.message : String(error),
            source: provider.source,
          });
        }
      }),
    );

    candidates.sort(
      (a, b) =>
        this.precedence[b.ref.source] - this.precedence[a.ref.source] || a.order - b.order,
    );

    let visibleKeys: Set<string>;
    try {
      const visible = await this.visibilityPolicy.filter(
        candidates.map(({ ref }) => ref),
        principal,
      );
      visibleKeys = new Set(visible.map(({ key }) => key));
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : String(error),
        source: 'visibility',
      });
      visibleKeys = new Set();
    }

    const entries: SkillRegistryEntry[] = [];
    const selectedByName = new Map<string, SkillRef>();

    for (const { ref } of candidates) {
      // Hidden entries are omitted entirely so registry diagnostics never reveal
      // skill metadata the principal is not allowed to see.
      if (!visibleKeys.has(ref.key)) continue;

      if (!isEnabledByPolicy(ref.source, policy)) {
        entries.push({ reason: 'policy', ref, status: 'disabled' });
        continue;
      }

      const winner = selectedByName.get(ref.name);
      if (winner) {
        entries.push({
          reason: 'precedence',
          ref,
          shadowedBy: winner.key,
          status: 'shadowed',
        });
        continue;
      }

      selectedByName.set(ref.name, ref);
      entries.push({ ref, status: 'available' });
    }

    return {
      entries,
      errors,
      policy,
      precedence: { ...this.precedence },
      skills: entries.filter(({ status }) => status === 'available').map(({ ref }) => ref),
    };
  }
}

/** Owner-only baseline policy. Product ACLs can replace this through dependency injection. */
export class OwnerOnlySkillVisibilityPolicy implements SkillVisibilityPolicy {
  async filter(refs: SkillRef[], principal: SkillVisibilityPrincipal): Promise<SkillRef[]> {
    return refs.filter((ref) => {
      if (ref.scope === 'builtin') return true;
      if (!ref.ownerId) return false;
      if (ref.scope === 'project') {
        return ref.ownerId === (principal.workspaceId ?? principal.userId);
      }
      return ref.ownerId === principal.userId;
    });
  }
}
