import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentState } from '@lobechat/agent-runtime';
import type { UIChatMessage } from '@lobechat/types';
import type { TopicExecutionSnapshot, WorkspaceRef } from '@lobechat/types/src/projectWorkspace';
import { eq } from 'drizzle-orm';

import { closeTestDB, getTestDB } from '@/database/core/getTestDB';
import { MessageModel } from '@/database/models/message';
import { ProjectWorkspaceModel, toWorkspaceRef } from '@/database/models/projectWorkspace';
import { agents } from '@/database/schemas/agent';
import { topics } from '@/database/schemas/topic';
import { users } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';
import {
  confirmWorkspaceBindingIntent,
  selectWorkspaceOnce,
} from '@/features/ChatInput/ControlBar/workspaceBindingActions';
import { normalizeWorkspaceIdentity, resolveExecutionContext } from '@/helpers/executionContext';
import { classifyTopicPlacement } from '@/helpers/topicPlacement';
import { InMemoryStreamEventManager } from '@/server/modules/AgentRuntime/InMemoryStreamEventManager';
import { createRuntimeExecutors } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { AiAgentService } from '@/server/services/aiAgent';
import type { DeviceGateway } from '@/server/services/deviceGateway';
import {
  DatabaseTopicWorkspaceBindingStore,
  ProjectWorkspaceService,
  WorkspaceAlreadyBoundError,
} from '@/server/services/projectWorkspace';
import type { ToolExecutionService } from '@/server/services/toolExecution';

import { parseExecutionContextValidation } from '../../../packages/device-gateway-client/src/http';
import { prepareToolCallExecution } from '../../../packages/local-file-shell/src/file/executionBoundary';

/**
 * Production Workspace Runtime seams, executed inside the Electron **main**
 * process and reached from the renderer through the preload IPC bridge.
 *
 * What is real here:
 *
 * - the database is the repository's own isolated PGlite instance created by
 *   `@/database/core/getTestDB`, migrated with the real `packages/database`
 *   migrations, so `project_workspaces` / `topics` invariants are checked
 *   against real rows, real constraints and real transactions;
 * - the filesystem is a unique temporary tree created under the `stateRoot`
 *   the harness passes in, and every path assertion is made against real
 *   directories and files (canonicalized with `realpath`, so macOS
 *   `/var` → `/private/var` never produces a false match);
 * - the workspace binding writer (`DatabaseTopicWorkspaceBindingStore`), the
 *   `ProjectWorkspaceService`, the device execution boundary
 *   (`prepareToolCallExecution`), the execution-context resolver and the topic
 *   placement classifier are all the production implementations.
 *
 * The **only** test doubles are external ports:
 *
 * 1. `chatProviderPort` / `heterogeneousDeviceDispatcher` — the external model
 *    and device transports. They never run a model; they only record that a
 *    turn reached the production dispatch edge so acceptance rows can
 *    distinguish "did not happen" from "happened and changed nothing".
 * 2. `deviceDirectoryPort` — the device gateway's directory probe used by
 *    `ProjectWorkspaceService.getOrCreate`. Because the Electron host *is* the
 *    device in this harness, it is implemented against the real filesystem
 *    rather than stubbed; it is counted as a device call.
 * 3. `traceExporterPort` — tracing is deliberately disabled for this isolated
 *    acceptance lane. It supplies the same empty callback/header contract as
 *    production when no trace exporter is configured.
 *
 * Nothing else is substituted. In particular no acceptance row returns a
 * constant: every value below is read back out of the database, the
 * filesystem, or a production function's return value.
 */

const USER_ID = 'user-workspace-runtime-e2e';
const OPERATION_ID = 'operation-workspace-runtime-e2e';

export interface WorkspaceRuntimeCounters {
  /** Device-boundary + device-gateway port invocations. */
  deviceCalls: number;
  /** Model provider port invocations. */
  providerCalls: number;
}

export interface WorkspaceRuntimeConsentRequest {
  actualCwd: string;
  deviceId: string;
  modes: Array<'exec' | 'read' | 'write'>;
  operationId: string;
  primaryCwd: string;
  requestedPath: string;
  topicId: string;
  version: 1;
}

export interface ElectronAcceptanceResultMap {
  'AC-P08': {
    consentToolMessages: UIChatMessage[];
    consentRequest: WorkspaceRuntimeConsentRequest;
    deviceCalls: number;
    displayedArguments: string;
    /**
     * The boundary code the out-of-scope structured read produced. Reads are
     * recoverable, so the boundary asks for consent (`INTERVENTION_REQUIRED`)
     * instead of hard-denying — that is exactly what puts the consent dialog
     * on screen.
     */
    interventionCode: string;
    providerCalls: number;
    requestedCwd: string;
    spawnCwd: string;
    warningCodes: string[];
  };
  'AC-W04': {
    boundWorkspaceIdAfter?: string;
    projectWorkspaceRowsAfter: number;
    projectWorkspaceRowsBefore: number;
    providerCalls: number;
    scratchDirectoriesAfter: string[];
    scratchDirectoriesBefore: string[];
    turnCwds: Array<string | undefined>;
  };
  'AC-W07': {
    concurrentDeviceCalls: number;
    directReadDeviceCalls: number;
    directReadScratchDirectories: string[];
    directReadScratchRows: number;
    persistedScratchRootPath: string;
    placement: { kind: string; reason?: string };
    scratchDirectoriesAfter: string[];
    scratchRowsAfter: number;
    scratchWorkspaceIds: string[];
    snapshotWorkspaceId?: string;
  };
  'AC-W08': {
    boundWorkspaceIdAfter?: string;
    boundWorkspaceIdBefore?: string;
    cwdAfter?: string;
    cwdBefore?: string;
    deviceId: string;
    formalWorkspaceId: string;
    formalWorkspaceRootPath: string;
    rejectionCode: string;
    scratchWorkspaceId: string;
    /** Read back out of `topics.metadata`; fed to the production renderer. */
    snapshotAfter?: TopicExecutionSnapshot;
    topicId: string;
    workspaceAfter?: WorkspaceRef;
    workspaceStateAfter?: string;
  };
  'AC-W09': {
    agentDefaultAfter: string;
    agentDefaultBefore: string;
    bindingBySource: Record<string, boolean>;
    boundWorkspaceIdsByTopic: Record<string, string | undefined>;
    createdTopicWorkspaceIds: string[];
    workspaceRowsAfterExplicitSources: number;
    workspaceRowsAfterRejectedSources: number;
    workspaceRowsBefore: number;
  };
  'AC-W10': {
    normalizedResumeIdentity: string;
    persistedIdentity: string;
    preBindCode: string;
    preBindProviderCalls: number;
    resumeCwd?: string;
    resumeError?: string;
    resumeProviderCalls: number;
    resumeSessionId?: string;
  };
  'AC-X02': {
    deviceCalls: number;
    matrix: Array<{
      client: 'new' | 'old';
      device: 'new' | 'old';
      hardValidated: boolean;
      passed: boolean;
      server: 'new' | 'old';
    }>;
  };
}

export type ElectronAcceptanceId = keyof ElectronAcceptanceResultMap;

export const electronAcceptanceIds: readonly ElectronAcceptanceId[] = [
  'AC-W04',
  'AC-W07',
  'AC-W08',
  'AC-W09',
  'AC-W10',
  'AC-P08',
  'AC-X02',
];

const isElectronAcceptanceId = (value: unknown): value is ElectronAcceptanceId =>
  typeof value === 'string' && (electronAcceptanceIds as readonly string[]).includes(value);

const listDirectory = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory).catch(() => [] as string[]);
  return [...entries].sort();
};

const errorCode = (error: unknown): string => {
  if (error instanceof WorkspaceAlreadyBoundError) return 'WORKSPACE_ALREADY_BOUND';
  const candidate = error as { code?: string; message?: string };
  return candidate?.code ?? candidate?.message ?? 'UNKNOWN';
};

export interface WorkspaceRuntimeAcceptanceRuntime {
  close: () => Promise<void>;
  counters: () => WorkspaceRuntimeCounters;
  filesystemRoot: string;
  run: <Id extends ElectronAcceptanceId>(
    acceptanceId: Id,
  ) => Promise<ElectronAcceptanceResultMap[Id]>;
}

export const createWorkspaceRuntimeAcceptanceRuntime = async (options: {
  stateRoot: string;
}): Promise<WorkspaceRuntimeAcceptanceRuntime> => {
  if (!options.stateRoot) {
    throw new Error('Workspace Runtime acceptance requires an isolated state root');
  }

  await mkdir(options.stateRoot, { recursive: true });
  // Unique per session, and canonicalized so every later comparison sees the
  // same path the device boundary will resolve to.
  const filesystemRoot = await realpath(
    await mkdtemp(path.join(options.stateRoot, 'workspace-runtime-')),
  );
  const homeDir = path.join(filesystemRoot, 'home');
  await mkdir(homeDir, { recursive: true });

  const counters: WorkspaceRuntimeCounters = { deviceCalls: 0, providerCalls: 0 };

  /** Test double #1: the model provider HTTP API. Counted, never modelled. */
  const chatProviderPort = {
    send: async (): Promise<{ content: string }> => {
      counters.providerCalls += 1;
      return { content: 'assistant turn' };
    },
  };

  const traceExporterPort = {
    createOptions: () => ({ callback: {}, headers: new Headers() }),
  };

  const heterogeneousDispatches: Array<Parameters<DeviceGateway['dispatchAgentRun']>[0]> = [];
  const heterogeneousDeviceDispatcher = {
    dispatchAgentRun: async (params) => {
      counters.deviceCalls += 1;
      heterogeneousDispatches.push(params);
      await chatProviderPort.send();
      return { success: true };
    },
  } satisfies Pick<DeviceGateway, 'dispatchAgentRun'>;

  /**
   * Test double #2: the device gateway directory probe. The Electron host is
   * the device here, so the probe is a real filesystem check.
   */
  const deviceDirectoryPort = {
    resolveWorkspacePath: async ({ path: candidate }: { deviceId: string; path: string }) => {
      counters.deviceCalls += 1;
      const canonical = await realpath(candidate).catch(() => undefined);
      if (!canonical) return undefined;
      const stats = await stat(canonical);
      return stats.isDirectory() ? { rootPath: canonical } : undefined;
    },
  };

  /** Every device execution goes through the production boundary, counted. */
  const runDeviceBoundary: typeof prepareToolCallExecution = (input) => {
    counters.deviceCalls += 1;
    return prepareToolCallExecution(input);
  };

  const db: LobeChatDatabase = await getTestDB();
  await db.insert(users).values({ id: USER_ID }).onConflictDoNothing();

  const workspaceModel = new ProjectWorkspaceModel(db, USER_ID);
  const service = new ProjectWorkspaceService({
    bindingStore: new DatabaseTopicWorkspaceBindingStore(db, USER_ID),
    resolveDeviceWorkspacePath: deviceDirectoryPort.resolveWorkspacePath,
    workspaceModel,
  });
  const aiAgentService = new AiAgentService(db, USER_ID, { heterogeneousDeviceDispatcher });

  const createTopic = async (id: string, agentId?: string) => {
    await db
      .insert(topics)
      .values({ agentId, id, title: id, userId: USER_ID })
      .onConflictDoNothing();
    return id;
  };

  const makeDirectory = async (...segments: string[]) => {
    const directory = path.join(filesystemRoot, ...segments);
    await mkdir(directory, { recursive: true });
    return realpath(directory);
  };

  const countWorkspaceRows = async (deviceId: string, kind?: 'device' | 'scratch') =>
    (await workspaceModel.list({ deviceId, kind })).length;

  const loadTopicExecution = async (
    topicId: string,
  ): Promise<{
    snapshot?: TopicExecutionSnapshot;
    workspace?: WorkspaceRef;
    workspaces: Record<string, WorkspaceRef>;
  }> => {
    const state = await service.resolveTopic(topicId);
    const workspace = state?.workspace;
    return {
      snapshot: state?.snapshot,
      workspace,
      workspaces: workspace?.id ? { [workspace.id]: workspace } : {},
    };
  };

  /** Production resolver, fed only with rows read back out of the database. */
  const resolveTopicContext = async (
    topicId: string,
    deviceId: string,
    options: { isHetero?: boolean } = {},
  ) => {
    const { snapshot, workspaces } = await loadTopicExecution(topicId);
    return resolveExecutionContext({
      isDesktop: true,
      isHetero: options.isHetero ?? false,
      onlineDeviceIds: [deviceId],
      operationId: OPERATION_ID,
      snapshot,
      workspaces,
    });
  };

  const acceptance: {
    [Id in ElectronAcceptanceId]: () => Promise<ElectronAcceptanceResultMap[Id]>;
  } = {
    /**
     * Five pure-chat turns on an unbound desktop topic must not create a
     * `project_workspaces` row or a scratch directory. The provider counter
     * proves the five turns actually ran instead of being skipped.
     */
    'AC-W04': async () => {
      const deviceId = 'device-w04';
      const agentId = 'agent-w04';
      const topicId = await createTopic('topic-w04-pure-chat');
      const scratchParent = await makeDirectory('w04', 'scratch');
      await db.insert(agents).values({ id: agentId, userId: USER_ID }).onConflictDoNothing();

      const messageModel = new MessageModel(db, USER_ID);
      const executors = createRuntimeExecutors({
        createTraceOptions: traceExporterPort.createOptions,
        initModelRuntime: async () =>
          ({
            chat: async (_payload: unknown, options: any) => {
              const response = await chatProviderPort.send();
              await options.callback?.onText?.(response.content);
              return new Response();
            },
          }) as any,
        messageModel,
        operationId: `${OPERATION_ID}-w04`,
        serverDB: db,
        stepIndex: 1,
        streamManager: new InMemoryStreamEventManager(),
        toolExecutionService: {
          executeTool: async () => {
            throw new Error('A pure-chat turn must not execute a tool');
          },
        } as ToolExecutionService,
        topicId,
        userId: USER_ID,
      });

      const projectWorkspaceRowsBefore = await countWorkspaceRows(deviceId);
      const scratchDirectoriesBefore = await listDirectory(scratchParent);
      const providerCallsBefore = counters.providerCalls;

      const turnCwds: Array<string | undefined> = [];
      for (let turn = 0; turn < 5; turn += 1) {
        const context = await resolveTopicContext(topicId, deviceId);
        turnCwds.push(context.cwd);
        await executors.call_llm!(
          {
            payload: {
              messages: [
                {
                  content: `pure chat turn ${turn + 1}`,
                  id: `message-w04-user-${turn + 1}`,
                  role: 'user',
                },
              ],
              model: 'workspace-runtime-e2e',
              provider: 'external-test-port',
            },
            type: 'call_llm',
          },
          {
            cost: {
              calculatedAt: new Date().toISOString(),
              currency: 'USD',
              llm: { byModel: [], currency: 'USD', total: 0 },
              tools: { byTool: [], currency: 'USD', total: 0 },
              total: 0,
            },
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            maxSteps: 10,
            messages: [],
            metadata: {
              agentId,
              executionContext: context,
              executionPlan: context.plan,
              topicId,
            },
            modelRuntimeConfig: {
              model: 'workspace-runtime-e2e',
              provider: 'external-test-port',
            },
            operationId: `${OPERATION_ID}-w04-${turn + 1}`,
            status: 'running',
            stepCount: turn,
            toolManifestMap: {},
            usage: {
              humanInteraction: {
                approvalRequests: 0,
                promptRequests: 0,
                selectRequests: 0,
                totalWaitingTimeMs: 0,
              },
              llm: {
                apiCalls: 0,
                processingTimeMs: 0,
                tokens: { input: 0, output: 0, total: 0 },
              },
              tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
            },
          },
        );
      }

      const { snapshot } = await loadTopicExecution(topicId);

      return {
        boundWorkspaceIdAfter: snapshot?.workspaceId,
        projectWorkspaceRowsAfter: await countWorkspaceRows(deviceId),
        projectWorkspaceRowsBefore,
        providerCalls: counters.providerCalls - providerCallsBefore,
        scratchDirectoriesAfter: await listDirectory(scratchParent),
        scratchDirectoriesBefore,
        turnCwds,
      };
    },

    /**
     * A consented absolute read must not create scratch state, and two
     * concurrent first default-cwd device operations must converge on exactly
     * one persisted scratch row with a stable snapshot.
     */
    'AC-W07': async () => {
      const deviceId = 'device-w07';
      const agentId = 'agent-w07';
      const topicId = await createTopic('topic-w07-scratch');
      const scratchParent = await makeDirectory('w07', 'scratch');
      // A `direct-user-message` operation root is only honoured inside the
      // device's HOME (or an approved mount), so the consented directory has
      // to live under the isolated home this session created.
      const documents = path.join(homeDir, 'w07-docs');
      await mkdir(documents, { recursive: true });
      const readTarget = path.join(documents, 'notes.md');
      await writeFile(readTarget, 'consented reading material');

      await db.insert(agents).values({ id: agentId, userId: USER_ID }).onConflictDoNothing();
      const messageModel = new MessageModel(db, USER_ID);
      const directParentId = 'message-w07-direct-parent';
      const batchParentId = 'message-w07-batch-parent';
      await messageModel.create(
        { agentId, content: 'read the note', role: 'assistant', topicId },
        directParentId,
      );
      await messageModel.create(
        { agentId, content: 'inspect the workspace', role: 'assistant', topicId },
        batchParentId,
      );

      const scratchRootsSeen: string[] = [];
      const toolExecutionService = {
        executeTool: async (
          tool: { apiName: string; arguments: string; id: string },
          context: any,
        ) => {
          const executionContext = context.executionContext;
          const args = JSON.parse(tool.arguments || '{}');
          const prepared = await runDeviceBoundary({
            apiName: tool.apiName,
            args,
            context: {
              accessRoots: executionContext?.accessRoots,
              cwd: executionContext?.cwd,
              workspaceRootPath: executionContext?.workspace?.rootPath,
            },
            homeDir,
            trace: { deviceId, operationId: OPERATION_ID, topicId },
          });
          if (executionContext?.workspace?.kind === 'scratch') {
            scratchRootsSeen.push(executionContext.workspace.rootPath);
          }

          const content =
            tool.apiName === 'readFile'
              ? await readFile(prepared.args.path as string, 'utf8')
              : String(prepared.args.cwd);
          return { content, error: null, executionTime: 0, state: {}, success: true };
        },
      } as ToolExecutionService;
      const streamManager = new InMemoryStreamEventManager();
      const scratchRoot = path.join(scratchParent, topicId);
      const executors = createRuntimeExecutors({
        bindScratchAfterToolSuccess: (input) => service.bindScratchAfterToolSuccess(input),
        ensureScratchWorkspace: async () => {
          await mkdir(scratchRoot, { recursive: true });
          return { root: await realpath(scratchRoot) };
        },
        messageModel,
        operationId: OPERATION_ID,
        serverDB: db,
        stepIndex: 1,
        streamManager,
        toolExecutionService,
        topicId,
        userId: USER_ID,
      });
      const createState = (
        accessRoots: NonNullable<AgentState['metadata']>['executionContext']['accessRoots'] = [],
      ): AgentState => ({
        cost: {
          calculatedAt: new Date().toISOString(),
          currency: 'USD',
          llm: { byModel: [], currency: 'USD', total: 0 },
          tools: { byTool: [], currency: 'USD', total: 0 },
          total: 0,
        },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        maxSteps: 10,
        messages: [],
        metadata: {
          activeDeviceId: deviceId,
          agentId,
          executionContext: {
            accessRoots,
            plan: { deviceId, kind: 'device', target: 'local' },
            unresolvedReason: 'no-workspace',
            version: 1,
          },
          topicId,
        },
        operationId: OPERATION_ID,
        status: 'running',
        stepCount: 0,
        toolManifestMap: {},
        usage: {
          humanInteraction: {
            approvalRequests: 0,
            promptRequests: 0,
            selectRequests: 0,
            totalWaitingTimeMs: 0,
          },
          llm: {
            apiCalls: 0,
            processingTimeMs: 0,
            tokens: { input: 0, output: 0, total: 0 },
          },
          tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
        },
      });

      const directReadDeviceCallsBefore = counters.deviceCalls;
      await executors.call_tool!(
        {
          payload: {
            parentMessageId: directParentId,
            toolCalling: {
              apiName: 'readFile',
              arguments: JSON.stringify({ path: readTarget }),
              id: 'tool-call-w07-direct',
              identifier: 'lobe-local-system',
              type: 'builtin',
            },
          },
          type: 'call_tool',
        },
        createState([
          {
            deviceId,
            modes: ['read'],
            operationId: OPERATION_ID,
            rootPath: documents,
            scope: 'operation',
            source: 'direct-user-message',
          },
        ]),
      );
      const directReadDeviceCalls = counters.deviceCalls - directReadDeviceCallsBefore;
      const directReadScratchRows = await countWorkspaceRows(deviceId, 'scratch');
      const directReadScratchDirectories = await listDirectory(scratchParent);

      const concurrentDeviceCallsBefore = counters.deviceCalls;
      await executors.call_tools_batch!(
        {
          payload: {
            parentMessageId: batchParentId,
            toolsCalling: [1, 2].map((index) => ({
              apiName: 'runCommand',
              arguments: JSON.stringify({ command: 'pwd' }),
              id: `tool-call-w07-default-${index}`,
              identifier: 'lobe-local-system',
              type: 'builtin' as const,
            })),
          },
          type: 'call_tools_batch',
        },
        createState(),
      );
      const concurrentDeviceCalls = counters.deviceCalls - concurrentDeviceCallsBefore;

      const { snapshot, workspace } = await loadTopicExecution(topicId);
      if (!workspace?.id) throw new Error('AC-W07 did not persist its scratch workspace');
      const placement = classifyTopicPlacement(
        snapshot,
        workspace?.id ? { id: workspace.id, kind: workspace.kind } : undefined,
      );

      return {
        concurrentDeviceCalls,
        directReadDeviceCalls,
        directReadScratchDirectories,
        directReadScratchRows,
        persistedScratchRootPath: workspace?.rootPath ?? '',
        placement: { kind: placement.kind, reason: (placement as { reason?: string }).reason },
        scratchDirectoriesAfter: await listDirectory(scratchParent),
        scratchRowsAfter: await countWorkspaceRows(deviceId, 'scratch'),
        scratchWorkspaceIds: scratchRootsSeen.map((root) =>
          root === workspace.rootPath ? workspace.id! : '',
        ),
        snapshotWorkspaceId: snapshot?.workspaceId,
      };
    },

    /**
     * A scratch-bound topic cannot be rebound onto a formal project directory:
     * the bind-once writer rejects it and the topic keeps its cwd. The result
     * feeds the production `WorkspaceChip` in the renderer.
     */
    'AC-W08': async () => {
      const deviceId = 'device-w08';
      const topicId = await createTopic('topic-w08-scratch');
      const scratchRoot = await makeDirectory('w08', 'scratch', topicId);
      const formalRoot = await makeDirectory('w08', 'project');

      const scratchBinding = await service.bindScratchAfterToolSuccess({
        deviceId,
        rootPath: scratchRoot,
        target: 'local',
        toolSucceeded: true,
        topicId,
      });

      const before = await resolveTopicContext(topicId, deviceId);
      const { snapshot: snapshotBefore } = await loadTopicExecution(topicId);

      const formal = await service.getOrCreate({
        deviceId,
        displayName: 'Masterino product workspace',
        kind: 'device',
        rootPath: formalRoot,
      });

      let rejectionCode = 'ALLOWED';
      try {
        await service.bindTopic({ target: 'local', topicId, workspaceId: formal.id });
      } catch (error) {
        rejectionCode = errorCode(error);
      }

      const after = await resolveTopicContext(topicId, deviceId);
      const { snapshot: snapshotAfter, workspace: workspaceAfter } =
        await loadTopicExecution(topicId);

      return {
        boundWorkspaceIdAfter: snapshotAfter?.workspaceId,
        boundWorkspaceIdBefore: snapshotBefore?.workspaceId,
        cwdAfter: after.cwd,
        cwdBefore: before.cwd,
        deviceId,
        formalWorkspaceId: formal.id,
        formalWorkspaceRootPath: formal.rootPath,
        rejectionCode,
        scratchWorkspaceId: scratchBinding.workspace.id!,
        snapshotAfter,
        topicId,
        workspaceAfter,
        workspaceStateAfter: workspaceAfter?.kind,
      };
    },

    /**
     * Only an explicit workspace action or a confirmed direct directory may
     * create a workspace-topic. Quote / code-block / attachment sources are
     * rejected before any write path, and the agent's persisted default is
     * never touched.
     */
    'AC-W09': async () => {
      const deviceId = 'device-w09';
      const agentId = 'agent-w09';
      const confirmedDirectory = await makeDirectory('w09', 'confirmed');
      const workspacePlusDirectory = await makeDirectory('w09', 'workspace-plus');
      const quotedDirectory = await makeDirectory('w09', 'quoted');
      const codeBlockDirectory = await makeDirectory('w09', 'code-block');
      const attachmentDirectory = await makeDirectory('w09', 'attachment');

      await db
        .insert(agents)
        .values({
          agencyConfig: { workingDirByDevice: { [deviceId]: '/agent/default' } },
          id: agentId,
          userId: USER_ID,
        })
        .onConflictDoNothing();
      const readAgentDefault = async () => {
        const [row] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
        if (!row) throw new Error('AC-W09 lost its persisted agent row');
        return JSON.stringify(row.agencyConfig ?? null);
      };
      const agentDefaultBefore = await readAgentDefault();
      const workspaceRowsBefore = await countWorkspaceRows(deviceId);

      // The intent words are kept adjacent to each other and after the path so
      // the phrase is recognized whatever the length of the absolute path is.
      const persistentRequest = (directory: string) =>
        `请在 ${directory} 开发，后续持续在这个目录工作`;

      const selectForTopic = async (topicId: string, selection: { path: string }) => {
        const context = await resolveTopicContext(topicId, deviceId);
        return selectWorkspaceOnce({
          effective: {
            context,
            draftKey: `acceptance:${topicId}`,
            isDraft: false,
            recommendation: { deviceId },
            state: context.workspace ? 'bound' : 'unbound',
            target: 'local',
            targetDeviceId: deviceId,
            topicId,
            workspace: context.workspace,
          },
          ports: {
            bindTopicWorkspace: async (input) => {
              try {
                const value = await service.bindTopic(input);
                return { ok: true, value };
              } catch (error) {
                return {
                  code:
                    error instanceof WorkspaceAlreadyBoundError
                      ? 'WORKSPACE_ALREADY_BOUND'
                      : 'UNKNOWN',
                  message: error instanceof Error ? error.message : String(error),
                  ok: false,
                };
              }
            },
            getOrCreateDeviceWorkspace: async (input) => {
              try {
                return { ok: true, value: await service.getOrCreate({ ...input, kind: 'device' }) };
              } catch (error) {
                return {
                  code: 'UNKNOWN',
                  message: error instanceof Error ? error.message : String(error),
                  ok: false,
                };
              }
            },
            rememberRecent: () => undefined,
            setDraftWorkspaceIntent: () => {
              throw new Error('AC-W09 uses existing topics, never a renderer-only draft');
            },
          },
          selection,
        });
      };

      const runMessageSource = async (params: {
        hasAttachments?: boolean;
        message: string;
        source: string;
      }) => {
        const topicId = await createTopic(`topic-w09-${params.source}`);
        let confirmationOpened = false;
        const shouldSend = await confirmWorkspaceBindingIntent({
          confirm: async ({ bind }) => {
            confirmationOpened = true;
            return bind();
          },
          desktop: true,
          effective: { state: 'unbound' },
          payload: {
            hasAttachments: params.hasAttachments ?? false,
            message: params.message,
          } as any,
          select: async (selection) => (await selectForTopic(topicId, selection)).ok,
        });
        const bound = await loadTopicExecution(topicId);
        return {
          bound: Boolean(bound.snapshot?.workspaceId),
          confirmationOpened,
          shouldSend,
          topicId,
        };
      };

      const attachment = await runMessageSource({
        hasAttachments: true,
        message: persistentRequest(attachmentDirectory),
        source: 'attachment',
      });
      const codeBlock = await runMessageSource({
        message: persistentRequest(`\`${codeBlockDirectory}\``),
        source: 'code-block',
      });
      const quote = await runMessageSource({
        message: `> ${persistentRequest(quotedDirectory)}`,
        source: 'quote',
      });

      // No rejected source reaches the production selection action, so the row
      // count remains at its pre-source baseline.
      const workspaceRowsAfterRejectedSources = await countWorkspaceRows(deviceId);

      const confirmed = await runMessageSource({
        message: persistentRequest(confirmedDirectory),
        source: 'confirmed',
      });
      const workspacePlusTopicId = await createTopic('topic-w09-workspace-plus');
      const workspacePlus = await selectForTopic(workspacePlusTopicId, {
        path: workspacePlusDirectory,
      });

      const createdTopicWorkspaceIds = [
        (await loadTopicExecution(confirmed.topicId)).snapshot?.workspaceId,
        (await loadTopicExecution(workspacePlusTopicId)).snapshot?.workspaceId,
      ].filter((workspaceId): workspaceId is string => Boolean(workspaceId));
      const [confirmedExecution, workspacePlusExecution] = await Promise.all([
        loadTopicExecution(confirmed.topicId),
        loadTopicExecution(workspacePlusTopicId),
      ]);
      const boundWorkspaceIdsByTopic: Record<string, string | undefined> = {
        [confirmed.topicId]: confirmedExecution.snapshot?.workspaceId,
        [workspacePlusTopicId]: workspacePlusExecution.snapshot?.workspaceId,
      };

      return {
        agentDefaultAfter: await readAgentDefault(),
        agentDefaultBefore,
        bindingBySource: {
          attachment: attachment.confirmationOpened || attachment.bound,
          codeBlock: codeBlock.confirmationOpened || codeBlock.bound,
          confirmedDirectory:
            confirmed.confirmationOpened && confirmed.bound && confirmed.shouldSend,
          quote: quote.confirmationOpened || quote.bound,
          workspacePlus: workspacePlus.ok,
        },
        boundWorkspaceIdsByTopic,
        createdTopicWorkspaceIds,
        workspaceRowsAfterExplicitSources: await countWorkspaceRows(deviceId),
        workspaceRowsAfterRejectedSources,
        workspaceRowsBefore,
      };
    },

    /**
     * A heterogeneous agent cannot send before a workspace exists, and after a
     * formal bind the resumed operation uses the canonical persisted identity.
     */
    'AC-W10': async () => {
      const deviceId = 'device-w10';
      const agentId = 'agent-w10-hetero';
      await db
        .insert(agents)
        .values({
          agencyConfig: {
            executionTargetByPlatform: { desktop: 'local', web: 'sandbox' },
            heterogeneousProvider: { type: 'claude-code' },
          },
          chatConfig: {},
          id: agentId,
          model: 'claude-code',
          plugins: [],
          provider: 'anthropic',
          userId: USER_ID,
        })
        .onConflictDoNothing();
      const topicId = await createTopic('topic-w10-hetero', agentId);
      const projectRoot = await makeDirectory('w10', 'project');

      const providerCallsBeforeSend = counters.providerCalls;
      const preBindResult = await aiAgentService.execAgent({
        agentId,
        appContext: {
          topicExecutionIntent: {
            platform: 'desktop',
            target: 'local',
            targetDeviceId: deviceId,
          },
          topicId,
        },
        deviceId,
        prompt: 'Run the project checks',
      });
      const preBindProviderCalls = counters.providerCalls - providerCallsBeforeSend;

      const workspace = await service.getOrCreate({
        deviceId,
        kind: 'device',
        rootPath: projectRoot,
      });
      await service.bindTopic({ target: 'local', topicId, workspaceId: workspace.id });
      const [boundTopic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
      await db
        .update(topics)
        .set({
          metadata: {
            ...boundTopic?.metadata,
            heteroSessionId: 'session-w10',
            workingDirectory: workspace.rootPath,
          },
        })
        .where(eq(topics.id, topicId));

      const providerCallsBeforeResume = counters.providerCalls;
      const dispatchesBeforeResume = heterogeneousDispatches.length;
      const resumeResult = await aiAgentService.execAgent({
        agentId,
        appContext: {
          topicExecutionIntent: {
            platform: 'desktop',
            target: 'local',
            targetDeviceId: deviceId,
          },
          topicId,
        },
        deviceId,
        prompt: 'Resume the project checks',
      });
      const resumeProviderCalls = counters.providerCalls - providerCallsBeforeResume;
      const resumeDispatch = heterogeneousDispatches.at(dispatchesBeforeResume);

      const persistedRow = await workspaceModel.findById(workspace.id);
      if (!persistedRow) throw new Error('AC-W10 lost its persisted workspace row');

      const normalizedResumeIdentity = resumeDispatch
        ? normalizeWorkspaceIdentity({
            deviceId: resumeDispatch.deviceId,
            id: persistedRow.id,
            kind: resumeDispatch.executionContext?.workspaceKind ?? persistedRow.kind,
            rootPath:
              resumeDispatch.executionContext?.workspaceRootPath ?? resumeDispatch.cwd ?? '',
          }).key
        : '';

      return {
        normalizedResumeIdentity,
        // Same row, denormalized on the way in: identity must still collapse.
        persistedIdentity: normalizeWorkspaceIdentity({
          ...toWorkspaceRef(persistedRow),
          rootPath: `${persistedRow.rootPath}/`,
        }).key,
        preBindCode: preBindResult.error ?? '',
        preBindProviderCalls,
        resumeCwd: resumeDispatch?.cwd,
        resumeError: resumeResult.success ? undefined : resumeResult.error,
        resumeProviderCalls,
        resumeSessionId: resumeDispatch?.resumeSessionId,
      };
    },

    /**
     * Out-of-scope shell + read evidence for the consent surface: the model's
     * cwd never reaches the prepared spawn arguments, the out-of-scope read
     * stops at the boundary asking for consent, and the runtime-authored
     * consent request carries the full real cwd and the requested path.
     */
    'AC-P08': async () => {
      const deviceId = 'device-p08';
      const topicId = await createTopic('topic-p08-consent');
      const workspaceRoot = await makeDirectory('p08', 'project');
      const outsideDirectory = await makeDirectory('p08', 'outside');
      const outsideFile = path.join(outsideDirectory, 'payroll.csv');
      await writeFile(outsideFile, 'employee,salary\n');
      const agentId = 'agent-p08';
      await db.insert(agents).values({ id: agentId, userId: USER_ID }).onConflictDoNothing();

      const deviceCallsBefore = counters.deviceCalls;
      const providerCallsBefore = counters.providerCalls;

      // Persist the primary workspace first, then resolve the same frozen
      // execution context the runtime consumes. This makes the consent request
      // come from the production request builder instead of the harness
      // restating transport fields.
      const workspace = await service.getOrCreate({
        deviceId,
        kind: 'device',
        rootPath: workspaceRoot,
      });
      await service.bindTopic({ target: 'local', topicId, workspaceId: workspace.id });
      const executionContext = await resolveTopicContext(topicId, deviceId);

      const prepared = await runDeviceBoundary({
        apiName: 'runCommand',
        args: { command: `cat ${outsideFile}`, cwd: outsideDirectory },
        context: { cwd: workspaceRoot, workspaceRootPath: workspaceRoot },
        homeDir,
        trace: { deviceId, operationId: OPERATION_ID, topicId },
      });

      const messageModel = new MessageModel(db, USER_ID);
      const assistantMessage = await messageModel.create({
        agentId,
        content: '',
        role: 'assistant',
        topicId,
      });
      const pendingToolsCalling = [
        {
          apiName: 'runCommand',
          arguments: JSON.stringify(prepared.args),
          id: 'tool-call-p08-shell',
          identifier: 'lobe-local-system',
          type: 'builtin',
        },
        {
          apiName: 'readFile',
          arguments: JSON.stringify({ path: outsideFile }),
          id: 'tool-call-p08-read',
          identifier: 'lobe-local-system',
          type: 'builtin',
        },
      ];
      const approvalExecutors = createRuntimeExecutors({
        messageModel,
        operationId: OPERATION_ID,
        serverDB: db,
        stepIndex: 1,
        streamManager: new InMemoryStreamEventManager(),
        toolExecutionService: {
          executeTool: async () => {
            throw new Error('AC-P08 stops before tool execution while approval is pending');
          },
        } as ToolExecutionService,
        topicId,
        userId: USER_ID,
      });
      await approvalExecutors.request_human_approve!(
        { pendingToolsCalling, type: 'request_human_approve' } as any,
        {
          cost: {
            calculatedAt: new Date().toISOString(),
            currency: 'USD',
            llm: { byModel: [], currency: 'USD', total: 0 },
            tools: { byTool: [], currency: 'USD', total: 0 },
            total: 0,
          },
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
          maxSteps: 10,
          messages: [{ ...assistantMessage, role: 'assistant' } as any],
          metadata: {
            activeDeviceId: deviceId,
            agentId,
            executionContext,
            executionPlan: executionContext.plan,
            topicId,
          },
          operationId: OPERATION_ID,
          pendingToolsCalling: [],
          status: 'running',
          stepCount: 0,
          toolManifestMap: {},
          usage: {
            humanInteraction: {
              approvalRequests: 0,
              promptRequests: 0,
              selectRequests: 0,
              totalWaitingTimeMs: 0,
            },
            llm: {
              apiCalls: 0,
              processingTimeMs: 0,
              tokens: { input: 0, output: 0, total: 0 },
            },
            tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
          },
        } as AgentState,
      );

      const consentToolMessages = (await messageModel.query({ agentId, topicId })).filter(
        (message) => message.role === 'tool',
      );
      const readToolMessage = consentToolMessages.find(
        (message) => message.tool_call_id === 'tool-call-p08-read',
      );
      const consentRequest = readToolMessage?.pluginState?.workspacePathConsent;
      if (!consentRequest) {
        throw new Error('AC-P08 request_human_approve did not persist workspace path consent');
      }

      let interventionCode = 'ALLOWED';
      try {
        await runDeviceBoundary({
          apiName: 'readFile',
          args: { path: outsideFile },
          context: { cwd: workspaceRoot, workspaceRootPath: workspaceRoot },
          homeDir,
          trace: { deviceId, operationId: OPERATION_ID, topicId },
        });
      } catch (error) {
        interventionCode = errorCode(error);
      }

      return {
        consentRequest,
        consentToolMessages,
        deviceCalls: counters.deviceCalls - deviceCallsBefore,
        displayedArguments: JSON.stringify(prepared.args),
        interventionCode,
        providerCalls: counters.providerCalls - providerCallsBefore,
        requestedCwd: outsideDirectory,
        // Read out of the prepared arguments: this is the directory the device
        // would actually spawn in, not a restatement of the input.
        spawnCwd: prepared.args.cwd as string,
        warningCodes: prepared.warnings.map(({ code }) => code),
      };
    },

    /**
     * The complete new/old client-server-device grid, executed against the
     * real device boundary and the real filesystem.
     */
    'AC-X02': async () => {
      const workspaceRoot = await makeDirectory('x02', 'project');
      const file = path.join(workspaceRoot, 'note.txt');
      await writeFile(file, 'ok');

      const deviceCallsBefore = counters.deviceCalls;
      const matrix: ElectronAcceptanceResultMap['AC-X02']['matrix'] = [];

      for (const client of ['new', 'old'] as const) {
        for (const server of ['new', 'old'] as const) {
          for (const device of ['new', 'old'] as const) {
            // Each version changes a real stage of the request: the client may
            // omit the envelope, the server may drop it, and the device either
            // enforces the v2 boundary or executes through the legacy adapter.
            const clientRequest =
              client === 'new'
                ? { executionContext: { cwd: workspaceRoot, workspaceRootPath: workspaceRoot } }
                : {};
            const serverRequest = server === 'new' ? clientRequest : ({} as typeof clientRequest);
            const deviceAuth =
              device === 'new'
                ? { capabilities: { executionContextValidation: true }, protocolVersion: 2 }
                : { capabilities: {}, protocolVersion: 1 };

            let deviceExecution:
              | { content: string; kind: 'legacy' }
              | { code: string; kind: 'rejected' }
              | { content: string; kind: 'validated'; primary: boolean };
            if (device === 'old') {
              deviceExecution = { content: await readFile(file, 'utf8'), kind: 'legacy' };
            } else {
              try {
                const prepared = await runDeviceBoundary({
                  apiName: 'readFile',
                  args: { path: file },
                  context: serverRequest.executionContext,
                  homeDir,
                });
                deviceExecution = {
                  // Read through the path the boundary resolved, not the input.
                  content: await readFile(prepared.args.path, 'utf8'),
                  kind: 'validated',
                  primary: prepared.scopeAudit[0]?.scopeVerdict === 'primary',
                };
              } catch (error) {
                deviceExecution = { code: errorCode(error), kind: 'rejected' };
              }
            }

            const deviceDeclaredV2Validation =
              deviceAuth.protocolVersion === 2 &&
              deviceAuth.capabilities.executionContextValidation === true;
            const wireAcknowledgement =
              server === 'new' &&
              serverRequest.executionContext &&
              deviceDeclaredV2Validation &&
              deviceExecution.kind === 'validated'
                ? 'hard'
                : undefined;
            const negotiated =
              client === 'new' ? parseExecutionContextValidation(wireAcknowledgement) : 'legacy';
            const hardValidated = negotiated === 'hard';
            const expectedHard = client === 'new' && server === 'new' && device === 'new';
            const executionPassed =
              deviceExecution.kind === 'legacy'
                ? deviceExecution.content === 'ok'
                : serverRequest.executionContext
                  ? deviceExecution.kind === 'validated' &&
                    deviceExecution.content === 'ok' &&
                    deviceExecution.primary
                  : deviceExecution.kind === 'rejected' &&
                    deviceExecution.code === 'WORKSPACE_REQUIRED';

            matrix.push({
              client,
              device,
              hardValidated,
              passed: hardValidated === expectedHard && executionPassed,
              server,
            });
          }
        }
      }

      return { deviceCalls: counters.deviceCalls - deviceCallsBefore, matrix };
    },
  };

  // The renderer mounts several acceptance surfaces at once. Their runs share
  // the counted provider/device ports, so overlapping executions would make a
  // row's before/after deltas include calls from a different row. Keep the
  // main-process scenarios deterministic while still memoizing each row in the
  // preload bridge.
  let acceptanceQueue: Promise<void> = Promise.resolve();

  return {
    close: async () => {
      try {
        await closeTestDB();
      } finally {
        await rm(filesystemRoot, { force: true, recursive: true });
      }
    },
    counters: () => ({ ...counters }),
    filesystemRoot,
    run: async (acceptanceId) => {
      if (!isElectronAcceptanceId(acceptanceId)) {
        throw new Error(`${String(acceptanceId)} is not an Electron acceptance row`);
      }

      const result = acceptanceQueue.then(() => acceptance[acceptanceId]());
      acceptanceQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result as never;
    },
  };
};
