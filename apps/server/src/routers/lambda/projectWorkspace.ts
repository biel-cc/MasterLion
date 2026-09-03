import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ProjectWorkspaceModel } from '@/database/models/projectWorkspace';
import { TopicModel } from '@/database/models/topic';
import { WorkspaceAccessGrantModel } from '@/database/models/workspaceAccessGrant';
import { isAbsoluteFilesystemPath } from '@/helpers/executionContext';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { WorkspaceEnvService } from '@/server/services/executionEnv';
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
  const workspaceService = new ProjectWorkspaceService({ bindingStore, workspaceModel });
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

const requireAbsolutePath = (rootPath: string) => {
  if (!isAbsoluteFilesystemPath(rootPath)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'rootPath must be absolute' });
  }
};

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
    .mutation(({ ctx, input }) => ctx.grantService.grant(input)),

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

  update: projectWorkspaceWriteProcedure
    .input(
      z
        .object({
          displayName: z.string().max(120).nullable().optional(),
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
