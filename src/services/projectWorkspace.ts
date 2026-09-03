import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type { WorkspaceInitResult } from '@lobechat/types/src/device';
import type { PathAccessMode, WorkspaceAccessGrant } from '@lobechat/types/src/executionContext';
import type {
  TopicExecutionSnapshot,
  WorkspaceBindDecision,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';
import type { ProjectWorkspaceSkillPolicy } from '@lobechat/types/src/projectWorkspace/skillAdapter';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Browser-facing projection of a `project_workspaces` row. Mirrors the A1
 * `ProjectWorkspaceDTO`; dates arrive as Date (superjson) or ISO strings.
 */
export interface ProjectWorkspaceItem {
  createdAt?: Date | string;
  deviceId?: string;
  displayName?: string;
  envFiles?: string[];
  envKeys?: Array<{ key: string; secret: boolean }>;
  id: string;
  kind: WorkspaceKind;
  lastUsedAt?: Date | string;
  repoType?: 'git' | 'github';
  rootPath: string;
  scan?: WorkspaceInitResult;
  scannedAt?: Date | string;
  skillPolicy?: ProjectWorkspaceSkillPolicy;
  updatedAt?: Date | string;
}

export interface TopicWorkspaceState {
  snapshot?: TopicExecutionSnapshot;
  workspace?: WorkspaceRef;
}

export interface BindTopicWorkspaceResult {
  decision: WorkspaceBindDecision;
  snapshot: TopicExecutionSnapshot;
  workspace: WorkspaceRef;
}

export interface GetOrCreateDeviceWorkspaceInput {
  deviceId: string;
  displayName?: string;
  repoType?: 'git' | 'github' | null;
  rootPath: string;
}

export interface BindTopicWorkspaceInput {
  target?: DeviceExecutionTarget;
  topicId: string;
  workspaceId: string;
}

export interface CaptureTopicTargetInput {
  boundDeviceId?: string;
  target: DeviceExecutionTarget;
  topicId: string;
}

export interface GrantTopicAccessInput {
  deviceId: string;
  expiresAt?: Date;
  modes: PathAccessMode[];
  requestedVia?: { messageId?: string; reason?: string; toolCallId?: string };
  rootPath: string;
  topicId: string;
}

export interface TopicGrantRefInput {
  deviceId: string;
  id: string;
  topicId: string;
}

export interface WorkspaceEnvEntrySummary {
  key: string;
  secret: boolean;
}

export interface SaveWorkspaceEnvEntryInput {
  key: string;
  secret: boolean;
  value: string;
}

export interface UpdateProjectWorkspaceInput {
  displayName?: string | null;
  repoType?: 'git' | 'github' | null;
  skillPolicy?: ProjectWorkspaceSkillPolicy | null;
}

/**
 * Narrow client seam over the A1 `projectWorkspaceRouter`. Stores and hooks
 * consume this interface only; tests inject a fake implementation.
 */
export interface ProjectWorkspaceClient {
  bindTopic: (input: BindTopicWorkspaceInput) => Promise<BindTopicWorkspaceResult>;
  captureTarget: (input: CaptureTopicTargetInput) => Promise<TopicExecutionSnapshot>;
  getOrCreate: (input: GetOrCreateDeviceWorkspaceInput) => Promise<ProjectWorkspaceItem>;
  getTopicState: (input: { topicId: string }) => Promise<TopicWorkspaceState | undefined>;
  grant: (input: GrantTopicAccessInput) => Promise<WorkspaceAccessGrant>;
  list: (input?: { deviceId?: string; kind?: WorkspaceKind }) => Promise<ProjectWorkspaceItem[]>;
  listEnv: (input: { workspaceId: string }) => Promise<WorkspaceEnvEntrySummary[]>;
  listGrants: (input: { deviceId: string; topicId: string }) => Promise<WorkspaceAccessGrant[]>;
  revoke: (input: TopicGrantRefInput) => Promise<WorkspaceAccessGrant>;
  revokeEnv: (input: { key: string; workspaceId: string }) => Promise<void>;
  saveEnv: (input: SaveWorkspaceEnvEntryInput & { workspaceId: string }) => Promise<void>;
  update: (input: UpdateProjectWorkspaceInput & { id: string }) => Promise<ProjectWorkspaceItem>;
}

export const PROJECT_WORKSPACE_SEAM_UNAVAILABLE = 'PROJECT_WORKSPACE_SEAM_UNAVAILABLE' as const;
export const WORKSPACE_ALREADY_BOUND = 'WORKSPACE_ALREADY_BOUND' as const;

/** Thrown when `projectWorkspaceRouter` is not registered on the lambda router yet. */
export class ProjectWorkspaceSeamUnavailableError extends Error {
  readonly code = PROJECT_WORKSPACE_SEAM_UNAVAILABLE;

  constructor() {
    super('projectWorkspace router is not registered on the lambda client');
    this.name = 'ProjectWorkspaceSeamUnavailableError';
  }
}

/** Client-side mirror of the A1 bind-once rejection. */
export class WorkspaceAlreadyBoundError extends Error {
  readonly code = WORKSPACE_ALREADY_BOUND;

  constructor() {
    super(WORKSPACE_ALREADY_BOUND);
    this.name = 'WorkspaceAlreadyBoundError';
  }
}

export const isWorkspaceAlreadyBoundError = (error: unknown): boolean => {
  if (error instanceof WorkspaceAlreadyBoundError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === WORKSPACE_ALREADY_BOUND || candidate.message === WORKSPACE_ALREADY_BOUND
  );
};

export const isProjectWorkspaceSeamUnavailableError = (error: unknown): boolean =>
  error instanceof ProjectWorkspaceSeamUnavailableError ||
  (!!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === PROJECT_WORKSPACE_SEAM_UNAVAILABLE);

interface RawProcedure<TInput, TOutput> {
  mutate: (input: TInput) => Promise<TOutput>;
  query: (input: TInput) => Promise<TOutput>;
}

/**
 * Structural shape of the A1 router as seen from the browser. Kept private so
 * the only `as unknown` cast in the codebase lives in this file. Integrate
 * wiring: once `projectWorkspaceRouter` is registered on `LambdaRouter`, delete
 * this interface and read `lambdaClient.projectWorkspace` directly.
 */
interface RawProjectWorkspaceRouter {
  bindTopic: RawProcedure<BindTopicWorkspaceInput, BindTopicWorkspaceResult>;
  captureTarget: RawProcedure<CaptureTopicTargetInput, TopicExecutionSnapshot>;
  getOrCreate: RawProcedure<GetOrCreateDeviceWorkspaceInput, ProjectWorkspaceItem>;
  getTopicState: RawProcedure<{ topicId: string }, TopicWorkspaceState | undefined>;
  grant: RawProcedure<GrantTopicAccessInput, WorkspaceAccessGrant>;
  list: RawProcedure<
    { deviceId?: string; kind?: WorkspaceKind } | undefined,
    ProjectWorkspaceItem[]
  >;
  listEnv: RawProcedure<{ workspaceId: string }, WorkspaceEnvEntrySummary[]>;
  listGrants: RawProcedure<{ deviceId: string; topicId: string }, WorkspaceAccessGrant[]>;
  revoke: RawProcedure<TopicGrantRefInput, WorkspaceAccessGrant>;
  revokeEnv: RawProcedure<{ key: string; workspaceId: string }, void>;
  saveEnv: RawProcedure<SaveWorkspaceEnvEntryInput & { workspaceId: string }, void>;
  update: RawProcedure<UpdateProjectWorkspaceInput & { id: string }, ProjectWorkspaceItem>;
}

const resolveDefaultClient = (): ProjectWorkspaceClient | undefined => {
  const router = (lambdaClient as unknown as { projectWorkspace?: RawProjectWorkspaceRouter })
    .projectWorkspace;
  // tRPC proxy clients materialize any property lazily, so also require the
  // procedure to be callable before treating the seam as wired.
  if (!router || typeof router.list?.query !== 'function') return undefined;

  return {
    bindTopic: (input) => router.bindTopic.mutate(input),
    captureTarget: (input) => router.captureTarget.mutate(input),
    getOrCreate: (input) => router.getOrCreate.mutate(input),
    getTopicState: (input) => router.getTopicState.query(input),
    grant: (input) => router.grant.mutate(input),
    list: (input) => router.list.query(input),
    listEnv: (input) => router.listEnv.query(input),
    listGrants: (input) => router.listGrants.query(input),
    revoke: (input) => router.revoke.mutate(input),
    revokeEnv: (input) => router.revokeEnv.mutate(input),
    saveEnv: (input) => router.saveEnv.mutate(input),
    update: (input) => router.update.mutate(input),
  };
};

const rethrowKnown = (error: unknown): never => {
  if (isWorkspaceAlreadyBoundError(error)) throw new WorkspaceAlreadyBoundError();
  throw error;
};

/**
 * Single chokepoint for the project workspace router. Read paths never bind;
 * only `bindTopic` / `captureTarget` write topic state, and both go through the
 * server-side bind-once store.
 */
export class ProjectWorkspaceService {
  constructor(
    private readonly resolveClient: () => ProjectWorkspaceClient | undefined = resolveDefaultClient,
  ) {}

  /** True when the router seam is reachable from this client build. */
  isAvailable(): boolean {
    return !!this.resolveClient();
  }

  private client(): ProjectWorkspaceClient {
    const client = this.resolveClient();
    if (!client) throw new ProjectWorkspaceSeamUnavailableError();
    return client;
  }

  list(input?: { deviceId?: string; kind?: WorkspaceKind }) {
    return this.client().list(input);
  }

  /** Value-free browser projection: names and secret flags only. */
  listEnv(workspaceId: string) {
    return this.client().listEnv({ workspaceId });
  }

  getTopicState(topicId: string) {
    return this.client().getTopicState({ topicId });
  }

  /** Formal device workspace get-or-create. Never binds a topic by itself. */
  getOrCreateDeviceWorkspace(input: GetOrCreateDeviceWorkspaceInput) {
    return this.client().getOrCreate(input);
  }

  async bindTopic(input: BindTopicWorkspaceInput): Promise<BindTopicWorkspaceResult> {
    try {
      return await this.client().bindTopic(input);
    } catch (error) {
      return rethrowKnown(error);
    }
  }

  captureTarget(input: CaptureTopicTargetInput) {
    return this.client().captureTarget(input);
  }

  listGrants(input: { deviceId: string; topicId: string }) {
    return this.client().listGrants(input);
  }

  grant(input: GrantTopicAccessInput) {
    return this.client().grant(input);
  }

  revoke(input: TopicGrantRefInput) {
    return this.client().revoke(input);
  }

  saveEnv(workspaceId: string, entry: SaveWorkspaceEnvEntryInput) {
    return this.client().saveEnv({ ...entry, workspaceId });
  }

  revokeEnv(workspaceId: string, key: string) {
    return this.client().revokeEnv({ key, workspaceId });
  }

  updateWorkspace(id: string, value: UpdateProjectWorkspaceInput) {
    return this.client().update({ id, ...value });
  }
}

export const createProjectWorkspaceService = (client: ProjectWorkspaceClient | undefined) =>
  new ProjectWorkspaceService(() => client);

export const projectWorkspaceService = new ProjectWorkspaceService();
