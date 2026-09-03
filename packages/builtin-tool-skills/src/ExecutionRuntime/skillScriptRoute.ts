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

export interface VerifiedDeviceSkillPaths {
  skillDir: string;
  workspaceRoot: string;
}

/** Implemented by the device gateway with filesystem realpath, never by the host. */
export type DeviceSkillPathVerifier = (input: {
  deviceId: string;
  skillDir: string;
  workspaceRoot: string;
}) => Promise<VerifiedDeviceSkillPaths | undefined>;

type CanonicalAbsolutePath = { flavor: 'posix' | 'windows'; value: string };

const canonicalizeAbsolutePath = (raw: string): CanonicalAbsolutePath | undefined => {
  if (!raw || raw.includes('\0')) return;

  const windowsMatch = /^([a-z]):[/\\](.*)$/i.exec(raw);
  if (windowsMatch) {
    const segments = windowsMatch[2].replaceAll('\\', '/').split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) return;
    const suffix = segments.filter(Boolean).join('/');
    return {
      flavor: 'windows',
      value: suffix
        ? `${windowsMatch[1].toUpperCase()}:/${suffix}`
        : `${windowsMatch[1].toUpperCase()}:/`,
    };
  }

  if (!raw.startsWith('/') || raw.includes('\\')) return;
  const segments = raw.slice(1).split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return;
  const suffix = segments.filter(Boolean).join('/');
  return { flavor: 'posix', value: suffix ? `/${suffix}` : '/' };
};

const isWithinWorkspace = (
  workspaceRoot: CanonicalAbsolutePath,
  candidate: CanonicalAbsolutePath,
): boolean => {
  if (workspaceRoot.flavor !== candidate.flavor) return false;
  const caseInsensitive = workspaceRoot.flavor === 'windows';
  const root = caseInsensitive ? workspaceRoot.value.toLowerCase() : workspaceRoot.value;
  const path = caseInsensitive ? candidate.value.toLowerCase() : candidate.value;
  if (root === '/') return path.startsWith('/');
  if (root.endsWith('/')) return path.startsWith(root);
  return path === root || path.startsWith(root + '/');
};

const workspaceRequired = (message: string): SkillScriptExecutionRoute => ({
  error: { code: 'WORKSPACE_REQUIRED', message },
  ok: false,
});

/** Sandbox keeps its provider-owned route; device execution requires gateway realpath evidence. */
export const resolveSkillScriptExecutionRoute = async (input: {
  context: ExecutionContext;
  skillDir?: string;
  verifyDevicePaths?: DeviceSkillPathVerifier;
}): Promise<SkillScriptExecutionRoute> => {
  const { context, skillDir, verifyDevicePaths } = input;

  if (context.plan.kind === 'none') {
    return workspaceRequired('A workspace is required to execute a skill script.');
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
  const lexicalWorkspace = workspaceDir && canonicalizeAbsolutePath(workspaceDir);
  const lexicalSkill = skillDir && canonicalizeAbsolutePath(skillDir);
  if (!lexicalWorkspace || !lexicalSkill || !isWithinWorkspace(lexicalWorkspace, lexicalSkill)) {
    return workspaceRequired(
      'A canonical workspace-local skill directory is required for device execution.',
    );
  }

  if (!verifyDevicePaths) {
    return workspaceRequired('Device realpath verification is required for skill execution.');
  }

  let verified: VerifiedDeviceSkillPaths | undefined;
  try {
    verified = await verifyDevicePaths({
      deviceId: context.plan.deviceId,
      skillDir: lexicalSkill.value,
      workspaceRoot: lexicalWorkspace.value,
    });
  } catch {
    return workspaceRequired('Device realpath verification failed for skill execution.');
  }

  const verifiedWorkspace = verified && canonicalizeAbsolutePath(verified.workspaceRoot);
  const verifiedSkill = verified && canonicalizeAbsolutePath(verified.skillDir);
  if (!verifiedWorkspace || !verifiedSkill || !isWithinWorkspace(verifiedWorkspace, verifiedSkill)) {
    return workspaceRequired('The verified skill directory is outside the device workspace.');
  }

  return {
    cwd: verifiedWorkspace.value,
    deviceId: context.plan.deviceId,
    env: {
      ...context.env?.values,
      SKILL_DIR: verifiedSkill.value,
      WORKSPACE_DIR: verifiedWorkspace.value,
    },
    kind: 'device',
    ok: true,
  };
};
