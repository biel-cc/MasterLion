import {
  OwnerOnlySkillVisibilityPolicy,
  SkillRegistry,
  type SkillRegistryResult,
} from '@lobechat/context-engine';
import type {
  SkillProvider,
  SkillProviderContext,
  SkillVisibilityPolicy,
  SkillVisibilityPrincipal,
} from '@lobechat/types/src/projectWorkspace';

export interface SkillRegistryServiceOptions {
  providers: SkillProvider[];
  visibilityPolicy?: SkillVisibilityPolicy;
}

/** Server-facing adapter around the transport-agnostic registry engine. */
export class SkillRegistryService {
  private readonly registry: SkillRegistry;

  constructor(options: SkillRegistryServiceOptions) {
    this.registry = new SkillRegistry({
      providers: options.providers,
      visibilityPolicy: options.visibilityPolicy ?? new OwnerOnlySkillVisibilityPolicy(),
    });
  }

  resolve(
    context: SkillProviderContext,
    principal: SkillVisibilityPrincipal,
  ): Promise<SkillRegistryResult> {
    return this.registry.resolve(context, principal);
  }

  async activate(
    name: string,
    context: SkillProviderContext,
    principal: SkillVisibilityPrincipal,
  ) {
    const result = await this.resolve(context, principal);
    return { ref: result.skills.find((skill) => skill.name === name), result };
  }
}
