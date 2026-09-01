import type { ExecutionWorkload, ShellEnvironmentPolicy } from '@lobechat/electron-client-ipc';
import type { RuntimeEnvConfig, RuntimeSelectedSkill } from '@lobechat/types';

const uniqueDeclaration = <T>(values: Array<T | undefined>): T | undefined => {
  const declared = [...new Set(values.filter((value): value is T => value !== undefined))];
  return declared.length === 1 ? declared[0] : undefined;
};

/**
 * Convert a persisted profile name into a local-only policy. Agent settings
 * never contain environment values; Electron main remains the sole resolver.
 */
export const resolveShellEnvironmentPolicy = (
  profile: RuntimeEnvConfig['shellEnvironmentProfile'],
): ShellEnvironmentPolicy => {
  switch (profile) {
    case 'core': {
      return { inherit: 'core' };
    }
    case 'isolated': {
      return { inherit: 'none' };
    }
    default: {
      // Preserve interactive-shell compatibility unless an agent opts into a
      // narrower profile.
      return { inherit: 'all' };
    }
  }
};

/** Resolve explicit selected-skill declarations without guessing from prose. */
export const resolveExecutionWorkload = (
  selectedSkills: RuntimeSelectedSkill[],
): ExecutionWorkload => {
  if (selectedSkills.length === 0) return { kind: 'unknown' };

  const runtime = uniqueDeclaration(selectedSkills.map((skill) => skill.execution?.runtime));
  const packageManager = uniqueDeclaration(
    selectedSkills.map((skill) => skill.execution?.packageManager),
  );

  return {
    bunCompatible: selectedSkills.every((skill) => skill.execution?.bunCompatible === true),
    kind: 'skill',
    masterinoOwned: selectedSkills.every((skill) => skill.masterinoOwned === true),
    ...(packageManager ? { packageManager } : {}),
    ...(runtime ? { runtime } : {}),
  };
};
