import type {
  ExecutionContext,
  ExecutionContextError,
} from '@lobechat/types/src/executionContext';

export type SkillScriptExecutionRoute =
  | {
      cwd: string;
      deviceId: string;
      env: Record<string, string>;
      kind: 'device';
      ok: true;
    }
  | { kind: 'sandbox'; ok: true }
  | { error: ExecutionContextError; ok: false };

const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/$/, '');

const isWithinWorkspace = (workspaceRoot: string, candidate: string): boolean => {
  const root = normalize(workspaceRoot);
  const path = normalize(candidate);
  const caseInsensitive = /^[a-z]:\//i.test(root);
  const comparedRoot = caseInsensitive ? root.toLowerCase() : root;
  const comparedPath = caseInsensitive ? path.toLowerCase() : path;
  return comparedPath === comparedRoot || comparedPath.startsWith(comparedRoot + '/');
};

/** Pure execution router. Sandbox returns no overrides so its existing mount path is preserved. */
export const resolveSkillScriptExecutionRoute = (input: {
  context: ExecutionContext;
  skillDir?: string;
}): SkillScriptExecutionRoute => {
  const { context, skillDir } = input;

  if (context.plan.kind === 'none') {
    return {
      error: {
        code: 'WORKSPACE_REQUIRED',
        message: 'A workspace is required to execute a skill script.',
      },
      ok: false,
    };
  }

  if (context.plan.kind === 'device-unrouted') {
    return {
      error: {
        code: 'DEVICE_UNROUTED',
        message: 'The selected device is unavailable for skill script execution.',
        unroutedReason: context.plan.reason,
      },
      ok: false,
    };
  }

  if (context.plan.kind === 'sandbox') return { kind: 'sandbox', ok: true };

  const workspaceDir = context.workspace?.rootPath ?? context.cwd;
  if (!workspaceDir || !skillDir || !isWithinWorkspace(workspaceDir, skillDir)) {
    return {
      error: {
        code: 'WORKSPACE_REQUIRED',
        message: 'A workspace-local skill directory is required for device execution.',
      },
      ok: false,
    };
  }

  return {
    cwd: workspaceDir,
    deviceId: context.plan.deviceId,
    env: {
      ...(context.env?.values ?? {}),
      SKILL_DIR: skillDir,
      WORKSPACE_DIR: workspaceDir,
    },
    kind: 'device',
    ok: true,
  };
};
