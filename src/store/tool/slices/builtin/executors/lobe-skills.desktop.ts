/**
 * Lobe Skills Executor (Desktop)
 *
 * Desktop version: all commands run locally via localFileService.
 * No cloud sandbox, no exportFile.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';
import type { BuiltinToolContext } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { localFileService } from '@/services/electron/localFileService';
import { agentSkillService } from '@/services/skill';

const createRuntime = (ctx: BuiltinToolContext) =>
  new SkillsExecutionRuntime({
    builtinSkills: filterBuiltinSkills(builtinSkills),
    deviceScriptRunner: async (command, options) => {
      const executionContext = ctx.executionContext!;
      const operationId = executionContext.operationId ?? ctx.operationId!;
      const topicId = ctx.topicId!;
      const workspaceRootPath = executionContext.workspace?.rootPath ?? executionContext.cwd;
      const isSkillScript = !!options.activatedSkills?.length;
      const extraRoot =
        isSkillScript && options.cwd !== workspaceRootPath
          ? {
              modes: ['read' as const, 'exec' as const],
              operationId,
              rootPath: options.cwd,
              scope: 'operation' as const,
              source: 'user-approval' as const,
            }
          : undefined;
      const result = await gatewayConnectionService.executeLocalToolCall({
        apiName: 'runCommand',
        args: { command, description: options.description },
        executionContext: {
          accessRoots: [...(executionContext.accessRoots ?? []), ...(extraRoot ? [extraRoot] : [])],
          cwd: options.cwd,
          envFiles: executionContext.envFiles,
          envRef: {
            agentId: ctx.agentId!,
            topicId,
            workspaceId: executionContext.workspace?.id,
          },
          workspaceKind: executionContext.workspace?.kind,
          workspaceRootPath,
        },
        purpose: isSkillScript ? 'skill-script' : 'skill-command',
        trace: {
          deviceId: options.deviceId,
          operationId,
          toolCallId: ctx.toolCallId!,
          topicId,
        },
      });
      return {
        exitCode: result.success ? 0 : 1,
        output: result.content ?? '',
        stderr: result.success ? undefined : result.content,
        success: result.success,
      };
    },
    deviceSkillPathVerifier: async ({ skillDir, workspaceRoot }) => {
      const [skill, workspace] = await Promise.all([
        localFileService.resolveRealPath({ path: skillDir }),
        localFileService.resolveRealPath({ path: workspaceRoot }),
      ]);
      if (!skill.success || !skill.path || !workspace.success || !workspace.path) return undefined;
      return { skillDir: skill.path, workspaceRoot: workspace.path };
    },
    executionContext: ctx.executionContext,
    projectSkills: ctx.operationSkills
      ?.filter(
        (skill): skill is typeof skill & { location: string } =>
          (skill.source === 'project' || skill.source === 'workspace') && !!skill.location,
      )
      .map(({ location, name }) => ({ location, name })),
    registryResult: ctx.operationSkills ? { skills: ctx.operationSkills } : undefined,
    skillDirectoryResolver: (skills) =>
      desktopSkillRuntimeService.resolveExecutionDirectory(skills),
    service: {
      findAll: () => agentSkillService.list(),
      findById: (id) => agentSkillService.getById(id),
      findByName: (name) => agentSkillService.getByName(name),
      readResource: async (id, path) => {
        const resource = await agentSkillService.readResource(id, path);
        const fullPath = await desktopSkillRuntimeService.resolveReferenceFullPath({
          path,
          skillId: id,
        });

        return {
          ...resource,
          fullPath,
        };
      },
    },
  });

export const skillsExecutor = new SkillsExecutor(createRuntime);
