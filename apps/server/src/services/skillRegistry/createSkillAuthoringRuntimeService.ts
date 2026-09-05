import type {
  ProjectSkillValidationResult,
  PromoteProjectSkillAdapter,
} from './ProjectSkillService';

export interface ProjectSkillAuthoringService {
  create: (input: { content: string; name: string }) => Promise<unknown>;
  delete: (name: string) => Promise<void>;
  pack: (name: string) => Promise<Uint8Array>;
  promoteToUser: <TResult>(
    name: string,
    adapter: PromoteProjectSkillAdapter<TResult>,
  ) => Promise<TResult>;
  rename: (name: string, newName: string) => Promise<unknown>;
  update: (input: { content: string; name: string; path: string }) => Promise<unknown>;
  validate: (name: string) => Promise<ProjectSkillValidationResult>;
}

/** Structural contract matched by @lobechat/builtin-tool-skill-authoring. */
export interface SkillAuthoringRuntimeServiceAdapter {
  create: (input: { content: string; name: string }) => Promise<unknown>;
  delete: (name: string) => Promise<void>;
  pack: (name: string) => Promise<Uint8Array>;
  promoteToUser: (name: string) => Promise<unknown>;
  rename: (name: string, newName: string) => Promise<unknown>;
  update: (input: { content: string; name: string; path: string }) => Promise<unknown>;
  validate: (name: string) => Promise<ProjectSkillValidationResult>;
}

/** Bridges the safe project service to the builtin runtime without owning dispatcher wiring. */
export const createSkillAuthoringRuntimeService = <TResult>(
  projectSkills: ProjectSkillAuthoringService,
  promotion: PromoteProjectSkillAdapter<TResult>,
): SkillAuthoringRuntimeServiceAdapter => ({
  create: (input) => projectSkills.create(input),
  delete: (name) => projectSkills.delete(name),
  pack: (name) => projectSkills.pack(name),
  promoteToUser: (name) => projectSkills.promoteToUser(name, promotion),
  rename: (name, newName) => projectSkills.rename(name, newName),
  update: (input) => projectSkills.update(input),
  validate: (name) => projectSkills.validate(name),
});
