import { z } from 'zod';

/** Canonical public wire schema for an Electron-local execution context. */
export const LocalExecutionContextRefSchema = z.object({
  contextId: z.string().min(1),
  version: z.literal(1),
});

export const LocalExecutionRuntimeCapabilitySchema = z.object({
  available: z.boolean(),
  version: z.string().optional(),
});

export const LocalExecutionRuntimePlanSchema = z.object({
  packageManager: z.enum(['bun', 'npm', 'pip', 'pnpm', 'uv', 'yarn']).optional(),
  packageManagerCapability: LocalExecutionRuntimeCapabilitySchema.optional(),
  packageManagerSource: z.enum(['default', 'lockfile', 'project', 'workload']).optional(),
  runtime: z.enum(['bun', 'node', 'python', 'shell']),
  runtimeCapability: LocalExecutionRuntimeCapabilitySchema,
  runtimeSource: z.enum(['compatibility', 'default', 'lockfile', 'project', 'workload']),
  status: z.enum(['missing', 'not_required', 'ready']),
});

/**
 * The concrete shell environment and executable paths deliberately stay in
 * Electron main. Renderer and server code only receive this safe snapshot.
 */
export const LocalExecutionContextSnapshotSchema = z.object({
  createdAt: z.string(),
  environment: z.object({
    inherited: z.enum(['all', 'core', 'none']),
    overriddenKeys: z.array(z.string()),
    pathEntryCount: z.number().int().nonnegative(),
    removedKeys: z.array(z.string()),
  }),
  ref: LocalExecutionContextRefSchema,
  runtimePlan: LocalExecutionRuntimePlanSchema,
  workspace: z.object({
    realPath: z.string(),
    source: z.enum(['managed', 'selected']),
    writableRoots: z.array(z.string()),
  }),
});

export type LocalExecutionContextRef = z.infer<typeof LocalExecutionContextRefSchema>;
export type LocalExecutionRuntime = z.infer<typeof LocalExecutionRuntimePlanSchema>['runtime'];
export type LocalExecutionPackageManager = NonNullable<
  z.infer<typeof LocalExecutionRuntimePlanSchema>['packageManager']
>;
export type LocalExecutionRuntimeCapability = z.infer<typeof LocalExecutionRuntimeCapabilitySchema>;
export type LocalExecutionRuntimePlan = z.infer<typeof LocalExecutionRuntimePlanSchema>;
export type LocalExecutionContextSnapshot = z.infer<typeof LocalExecutionContextSnapshotSchema>;
