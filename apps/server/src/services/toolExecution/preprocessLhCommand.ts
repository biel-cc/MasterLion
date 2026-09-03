import debug from 'debug';

import type { ExecutionEnv } from '@lobechat/types/src/executionContext';
import { composeChildProcessEnv } from '@lobechat/local-file-shell/src/env';

import { appEnv } from '@/envs/app';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { isDev } from '@/utils/env';

const log = debug('lobe-server:lh-command');

export interface PreprocessResult {
  command: string;
  /** Server/device-only child environment. Never return this field to a renderer. */
  env?: Record<string, string>;
  error?: string;
  isLhCommand: boolean;
  skipSkillLookup: boolean;
}

export interface PreprocessLhCommandOptions {
  /** Already resolved by the operation-scoped ExecutionEnvAdapter. */
  executionEnv?: Pick<ExecutionEnv, 'values'>;
  /** Keep true until the caller is wired to forward `result.env` to its execution channel. */
  injectAuthInCommand?: boolean;
  /** Runtime-owned process environment for local execution. */
  runtimeEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * Detect and preprocess `lh` CLI commands.
 * - Replaces `lh` with `npx -y @lobehub/cli`
 * - Injects LOBEHUB_JWT and LOBEHUB_SERVER env vars
 * - Signals caller to skip skill DB lookup
 */
export const preprocessLhCommand = async (
  command: string,
  userId: string,
  options: PreprocessLhCommandOptions = {},
): Promise<PreprocessResult> => {
  // Match `lh` at the start of the command or after shell operators (&&, ||, ;)
  const lhPattern = /(?:^|&&|\|\||;)\s*lh(?:\s|$)/;
  const isLhCommand = lhPattern.test(command);

  if (!isLhCommand) {
    return { command, isLhCommand: false, skipSkillLookup: false };
  }

  try {
    const jwt = await signUserJWT(userId);

    const serverUrl = isDev ? 'https://aihub.bielcrystal.com' : appEnv.APP_URL;

    const envPrefix = `LOBEHUB_JWT=${jwt} LOBEHUB_SERVER=${serverUrl}`;
    const runtimeAuthEnv = { LOBEHUB_JWT: jwt, LOBEHUB_SERVER: serverUrl };
    const env = composeChildProcessEnv({
      hostEnv: options.runtimeEnv ?? {},
      resolvedEnv: options.executionEnv?.values,
      runtimeEnv: runtimeAuthEnv,
    });
    const commandPrefix = options.injectAuthInCommand === false ? '' : `${envPrefix} `;

    // Replace `lh` in all sub-commands separated by &&, ||, or ;
    const rewritten = command.replaceAll(
      /(^|&&|\|\||;)(\s*)lh(\s|$)/g,
      `$1$2${commandPrefix}npx -y @lobehub/cli$3`,
    );
    const finalCommand = rewritten;

    log('Intercepted lh command for user %s', userId);

    return { command: finalCommand, env, isLhCommand: true, skipSkillLookup: true };
  } catch {
    log('Failed to sign user JWT for lh command');
    return {
      command,
      error: 'Failed to authenticate for CLI execution',
      isLhCommand: true,
      skipSkillLookup: true,
    };
  }
};
