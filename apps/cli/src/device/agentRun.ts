import { spawn } from 'node:child_process';

import {
  type HeterogeneousSkillMaterializationMode,
  type MaterializableSkill,
  materializeSkillsForCli,
} from '@lobechat/device-control';
import {
  buildHeteroExecStdinPayload,
  type HeteroExecImageRef,
} from '@lobechat/heterogeneous-agents/protocol';
import {
  composeChildProcessEnv,
  loadWorkspaceEnvFiles,
  resolveLoginShellPath,
} from '@lobechat/local-file-shell';

export interface SpawnHeteroAgentRunParams {
  agentType: string;
  cwd?: string;
  /** Server-resolved environment layered into the child process. */
  env?: Record<string, string>;
  envFiles?: string[];
  /** Image attachments (signed URLs) appended as image content blocks. */
  imageList?: HeteroExecImageRef[];
  jwt: string;
  operationId: string;
  prompt: string;
  resumeSessionId?: string;
  serverUrl: string;
  skillPolicy?: HeterogeneousSkillMaterializationMode;
  skills?: MaterializableSkill[];
  systemContext?: string;
  topicId: string;
}

export interface AgentRunAckResult {
  reason?: string;
  status: 'accepted' | 'rejected';
}

interface SpawnHeteroAgentRunLogger {
  error?: (msg: string) => void;
  info?: (msg: string) => void;
}

/**
 * Spawn `lh hetero exec` for a gateway-dispatched agent run. Mirrors the
 * desktop app's `spawnLhHeteroExec`: the spawned CLI owns the full pipeline
 * (spawn -> adapt -> BatchIngester -> server ingest), so the connect daemon
 * needs no local stream handling — it only kicks off the process.
 *
 * Re-invokes the current CLI entry (`process.execPath` + `process.argv[1]`)
 * instead of relying on `lh` being on `PATH`, so it also works inside the
 * detached `lh connect --daemon` child where `PATH` may be minimal.
 *
 * Resolves only once the child's outcome is known: `accepted` on the `spawn`
 * event, `rejected` on an early `error`. `spawn()` reports failures (missing or
 * inaccessible `cwd`, etc.) asynchronously via `error`, so acking eagerly would
 * report a false success and leave the run with no process to emit
 * `heteroFinish` — surfacing as a stuck assistant message. A rejected ack
 * instead flows back as a dispatch failure the user can see.
 */
export async function spawnHeteroAgentRun(
  params: SpawnHeteroAgentRunParams,
  logger?: SpawnHeteroAgentRunLogger,
): Promise<AgentRunAckResult> {
  const {
    agentType,
    cwd,
    env,
    envFiles,
    imageList,
    jwt,
    operationId,
    prompt,
    resumeSessionId,
    skills,
    skillPolicy,
    serverUrl,
    systemContext,
    topicId,
  } = params;
  const workDir = cwd?.trim();
  if (!workDir) {
    return { reason: 'WORKSPACE_REQUIRED', status: 'rejected' };
  }

  if ((skillPolicy ?? 'off') !== 'off') {
    const materialization = await materializeSkillsForCli({
      agentType,
      cwd: workDir,
      policy: skillPolicy,
      skills,
    });
    if (materialization.errors.length > 0) {
      return {
        reason: `SKILL_MATERIALIZATION_FAILED: ${materialization.errors
          .map(({ message }) => message)
          .join('; ')}`,
        status: 'rejected',
      };
    }
  }

  // Server-ingest mode (--topic + --operation-id): events are batch-POSTed to
  // the server, not rendered. `--input-json -` reads the prompt from stdin.
  const cliArgs = [
    process.argv[1],
    'hetero',
    'exec',
    '--type',
    agentType,
    '--operation-id',
    operationId,
    '--topic',
    topicId,
    '--render',
    'none',
    '--input-json',
    '-',
    '--cwd',
    workDir,
    ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
  ];

  // systemContext / image attachments turn the payload into a content-block
  // array: context block first, then the user's prompt, then images — mirrors
  // the desktop path. `lh hetero exec` coerces both shapes via
  // coerceJsonPrompt.
  const stdinPayload = buildHeteroExecStdinPayload({ imageList, prompt, systemContext });
  const fileEnv = await loadWorkspaceEnvFiles({ envFiles, workspaceRootPath: workDir });
  const childEnv = composeChildProcessEnv({
    hostEnv: process.env,
    loginShellPath: await resolveLoginShellPath(),
    resolvedEnv: { ...fileEnv, ...env },
    runtimeEnv: { LOBEHUB_JWT: jwt, LOBEHUB_SERVER: serverUrl },
  });

  return new Promise<AgentRunAckResult>((resolve) => {
    let settled = false;
    const settle = (result: AgentRunAckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(process.execPath, [...process.execArgv, ...cliArgs], {
      cwd: workDir,
      env: childEnv,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    child.once('spawn', () => {
      // Only safe to write stdin once the process actually started.
      try {
        child.stdin?.write(stdinPayload);
        child.stdin?.end();
      } catch (err) {
        logger?.error?.(
          `hetero exec stdin write failed (op=${operationId}): ${(err as Error).message}`,
        );
      }
      settle({ status: 'accepted' });
    });

    child.once('error', (err) => {
      logger?.error?.(`hetero exec spawn failed (op=${operationId}): ${err.message}`);
      settle({ reason: err.message, status: 'rejected' });
    });

    child.on('exit', (code, signal) => {
      logger?.info?.(`hetero exec exited (op=${operationId}) code=${code} signal=${signal}`);
    });
  });
}
