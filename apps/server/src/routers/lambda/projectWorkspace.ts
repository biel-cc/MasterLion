import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { WorkspaceAccessGrantModel } from '@/database/models/workspaceAccessGrant';
import { isAbsoluteFilesystemPath } from '@/helpers/executionContext';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { DeviceGateway } from '@/server/services/deviceGateway';
import {
  resolveDesktopExecutionEnv,
  UserEnvService,
  WorkspaceEnvService,
} from '@/server/services/executionEnv';
import {
  DatabaseTopicWorkspaceBindingStore,
  ProjectWorkspaceService,
} from '@/server/services/projectWorkspace';
import { WorkspaceAccessGrantService } from '@/server/services/workspaceAccessGrant';

const workspaceKindSchema = z.enum(['device', 'sandbox', 'scratch']);
const executionTargetSchema = z.enum(['local', 'device', 'sandbox', 'none']);
const accessModeSchema = z.enum(['read', 'write', 'exec']);
const skillPolicySchema = z
  .object({
    includeAgentSkills: z.boolean().optional(),
    includeProjectSkills: z.boolean().optional(),
    includeUserSkills: z.boolean().optional(),
    materializeForHeteroCli: z.enum(['off', 'project', 'user']).optional(),
    pinned: z.array(z.string()).optional(),
  })
  .strict();

const projectWorkspaceProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceModel = new ProjectWorkspaceModel(ctx.serverDB, ctx.userId);
  const bindingStore = new DatabaseTopicWorkspaceBindingStore(
    ctx.serverDB,
    ctx.userId,
    ctx.workspaceId ?? undefined,
  );
  const deviceGateway = new DeviceGateway();
  const workspaceService = new ProjectWorkspaceService({
    bindingStore,
    resolveDeviceWorkspacePath: async ({ deviceId, path }) => {
      const rootPath = await deviceGateway.resolveRealPath({
        deviceId,
        path,
        userId: ctx.userId,
      });
      if (!rootPath) return undefined;

      // Inspect the canonical target, not the lexical path. Besides avoiding
      // persistence of symlink spellings, this closes the gap where the
      // original path could be replaced between stat and realpath.
      const status = await deviceGateway.statPath({
        deviceId,
        path: rootPath,
        userId: ctx.userId,
      });
      if (!status?.exists || !status.isDirectory) return undefined;

      return { repoType: status.repoType, rootPath };
    },
    workspaceModel,
  });
  const grantService = new WorkspaceAccessGrantService({
    grantModel: new WorkspaceAccessGrantModel(ctx.serverDB, ctx.userId),
    topicModel: new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
  });

  return opts.next({ ctx: { grantService, workspaceService } });
});

const projectWorkspaceWriteProcedure = projectWorkspaceProcedure.use(
  withScopedPermission('topic:update'),
);

const getWorkspaceEnvService = async (ctx: {
  serverDB: ConstructorParameters<typeof ProjectWorkspaceModel>[0];
  userId: string;
}) =>
  new WorkspaceEnvService(
    new ProjectWorkspaceModel(ctx.serverDB, ctx.userId),
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );

const getUserEnvService = async (ctx: {
  serverDB: ConstructorParameters<typeof UserModel>[0];
  userId: string;
}) =>
  new UserEnvService(
    new UserModel(ctx.serverDB, ctx.userId),
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );

const requireAbsolutePath = (rootPath: string) => {
  if (!isAbsoluteFilesystemPath(rootPath)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'rootPath must be absolute' });
  }
};

const envFilePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const normalized = value.replaceAll('\\', '/');
      return (
        !normalized.startsWith('/') &&
        !/^[A-Z]:\//i.test(normalized) &&
        !normalized.split('/').includes('..')
      );
    },
    { message: 'envFiles entries must be workspace-relative paths without traversal' },
  );

export const projectWorkspaceRouter = router({
  bindTopic: projectWorkspaceWriteProcedure
    .input(
      z.object({
        target: executionTargetSchema.optional(),
        topicId: z.string().min(1),
        workspaceId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.workspaceService.bindTopic({
        ...input,
        target: input.target as DeviceExecutionTarget | undefined,
      }),
    ),

  captureTarget: projectWorkspaceWriteProcedure
    .input(
      z.object({
        boundDeviceId: z.string().min(1).optional(),
        target: executionTargetSchema,
        topicId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.workspaceService.captureTarget({
        ...input,
        target: input.target as DeviceExecutionTarget,
      }),
    ),

  get: projectWorkspaceProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.workspaceService.get(input.id);
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      return workspace;
    }),

  getOrCreate: projectWorkspaceWriteProcedure
    .input(
      z.object({
        deviceId: z.string().min(1),
        displayName: z.string().max(120).optional(),
        repoType: z.enum(['git', 'github']).nullable().optional(),
        rootPath: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      requireAbsolutePath(input.rootPath);
      return ctx.workspaceService.getOrCreate({
        ...input,
        kind: 'device',
        workspaceId: ctx.workspaceId ?? null,
      });
    }),

  getTopicState: projectWorkspaceProcedure
    .input(z.object({ topicId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.workspaceService.resolveTopic(input.topicId)),

  /** Value-free authority probe used before Electron chooses an in-process runtime. */
  getManagedEnvSummary: projectWorkspaceProcedure
    .input(
      z.object({
        topicId: z.string().min(1).optional(),
        workspaceId: z.string().min(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const topicState = input.topicId
        ? await ctx.workspaceService.resolveTopic(input.topicId)
        : undefined;
      if (input.topicId && !topicState) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
      }
      const workspaceId = topicState?.workspace?.id ?? input.workspaceId;
      const [userEnvKeys, workspace] = await Promise.all([
        (await getUserEnvService(ctx)).list(),
        workspaceId ? ctx.workspaceService.get(workspaceId) : undefined,
      ]);
      if (workspaceId && !workspace) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      }
      const workspaceEnvKeys = workspace?.envKeys ?? [];
      const envFiles = workspace?.envFiles ?? [];
      return {
        envFiles,
        hasManagedEnv: userEnvKeys.length > 0 || workspaceEnvKeys.length > 0 || envFiles.length > 0,
        userEnvKeys,
        workspaceEnvKeys,
      };
    }),

  /** Authenticated desktop main-process lane. Never call this from browser code. */
  getResolvedEnv: projectWorkspaceProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        topicId: z.string().min(1).optional(),
        workspaceId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
      try {
        return await resolveDesktopExecutionEnv(input, {
          decrypt: async (encryptedValue) => {
            const decrypted = await gateKeeper.decrypt(encryptedValue);
            if (!decrypted.wasAuthentic) {
              throw new Error('Workspace environment authentication failed');
            }
            return decrypted.plaintext;
          },
          loadAgentAgencyConfig: async (agentId) => {
            const agent = await new AgentModel(
              ctx.serverDB,
              ctx.userId,
              ctx.workspaceId ?? undefined,
            ).getAgentConfigById(agentId);
            return agent ? (agent.agencyConfig ?? {}) : null;
          },
          loadTopicWorkspaceId: async (topicId) => {
            const state = await ctx.workspaceService.resolveTopic(topicId);
            return state === undefined ? undefined : (state.workspace?.id ?? null);
          },
          loadUserEnv: async () =>
            (await new UserModel(ctx.serverDB, ctx.userId).getUserSettings())?.executionEnv ??
            undefined,
          loadWorkspaceEnv: async (workspaceId) => {
            const workspace = await new ProjectWorkspaceModel(ctx.serverDB, ctx.userId).findById(
              workspaceId,
            );
            return workspace ? (workspace.env ?? undefined) : null;
          },
          userId: ctx.userId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to resolve environment';
        if (message.endsWith('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message });
        }
        if (message.includes('does not match')) {
          throw new TRPCError({ code: 'FORBIDDEN', message });
        }
        throw error;
      }
    }),

  listUserEnv: projectWorkspaceProcedure.query(async ({ ctx }) =>
    (await getUserEnvService(ctx)).list(),
  ),

  listEnv: projectWorkspaceProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => (await getWorkspaceEnvService(ctx)).list(input.workspaceId)),

  grant: projectWorkspaceWriteProcedure
    .input(
      z.object({
        deviceId: z.string().min(1),
        expiresAt: z.coerce.date().optional(),
        modes: z.array(accessModeSchema).min(1),
        requestedVia: z
          .object({
            messageId: z.string().optional(),
            reason: z.string().max(500).optional(),
            toolCallId: z.string().optional(),
          })
          .strict()
          .optional(),
        rootPath: z.string().min(1),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAbsolutePath(input.rootPath);
      const rootPath = await new DeviceGateway().resolveRealPath({
        deviceId: input.deviceId,
        path: input.rootPath,
        userId: ctx.userId,
      });
      if (!rootPath) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The selected device could not prove the requested real path',
        });
      }
      return ctx.grantService.grant({ ...input, rootPath });
    }),

  list: projectWorkspaceProcedure
    .input(
      z
        .object({
          deviceId: z.string().min(1).optional(),
          kind: workspaceKindSchema.optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => ctx.workspaceService.list(input ?? {})),

  listGrants: projectWorkspaceProcedure
    .input(z.object({ deviceId: z.string().min(1), topicId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.grantService.listActive(input)),

  resolveRealPath: projectWorkspaceProcedure
    .input(z.object({ deviceId: z.string().min(1), path: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      requireAbsolutePath(input.path);
      const resolved = await new DeviceGateway().resolveRealPath({
        deviceId: input.deviceId,
        path: input.path,
        userId: ctx.userId,
      });
      if (!resolved) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Trusted realpath is unavailable for the selected device',
        });
      }
      requireAbsolutePath(resolved);
      return { path: resolved };
    }),

  revoke: projectWorkspaceWriteProcedure
    .input(
      z.object({
        deviceId: z.string().min(1),
        id: z.string().min(1),
        topicId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const grant = await ctx.grantService.revoke(input);
      if (!grant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Grant not found' });
      return grant;
    }),

  revokeEnv: projectWorkspaceWriteProcedure
    .input(z.object({ key: z.string().min(1), workspaceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) =>
      (await getWorkspaceEnvService(ctx)).revoke(input.workspaceId, input.key),
    ),

  revokeUserEnv: projectWorkspaceWriteProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => (await getUserEnvService(ctx)).revoke(input.key)),

  saveEnv: projectWorkspaceWriteProcedure
    .input(
      z.object({
        key: z.string().min(1),
        secret: z.boolean(),
        value: z.string().min(1),
        workspaceId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => (await getWorkspaceEnvService(ctx)).save(input)),

  saveUserEnv: projectWorkspaceWriteProcedure
    .input(
      z.object({
        key: z.string().min(1),
        secret: z.boolean(),
        value: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => (await getUserEnvService(ctx)).save(input)),

  update: projectWorkspaceWriteProcedure
    .input(
      z
        .object({
          displayName: z.string().max(120).nullable().optional(),
          envFiles: z.array(envFilePathSchema).max(10).optional(),
          id: z.string().min(1),
          repoType: z.enum(['git', 'github']).nullable().optional(),
          skillPolicy: skillPolicySchema.nullable().optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...value } = input;
      const workspace = await ctx.workspaceService.update(id, value);
      if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
      return workspace;
    }),
});

export type ProjectWorkspaceRouter = typeof projectWorkspaceRouter;
