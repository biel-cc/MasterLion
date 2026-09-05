import type { ListProjectSkillsResult } from '@lobechat/electron-client-ipc';
import type { WorkspaceInitResult } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { localFileService } from '@/services/electron/localFileService';
import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Project skills chokepoint. Picks the transport per call from `deviceId`: a
 * remote / web target goes through the `device.listProjectSkills` RPC; the local
 * desktop talks to Electron over IPC. UI / store only see this service — the
 * electron-vs-lambda decision never leaks up. (Parallels `projectFileService`.)
 */
class ProjectSkillService {
  async scanWorkspace({
    scope,
    deviceId,
  }: {
    scope: string;
    deviceId?: string;
  }): Promise<WorkspaceInitResult> {
    const result = deviceId
      ? await lambdaClient.device.initWorkspace.query({ deviceId, scope })
      : await ensureElectronIpc().workspace.initWorkspace({ scope });
    if (!result)
      throw new Error('Project workspace scan failed; check the device connection and retry.');
    return { instructions: result.instructions ?? [], skills: result.skills ?? [] };
  }

  /** List `.agents/skills` / `.claude/skills` for a working directory. */
  async listProjectSkills({
    deviceId,
    scope,
  }: {
    deviceId?: string;
    scope: string;
  }): Promise<ListProjectSkillsResult | undefined> {
    const result = deviceId
      ? ((await lambdaClient.device.listProjectSkills.query({ deviceId, scope })) ?? undefined)
      : await localFileService.listProjectSkills({ scope });
    if (!result) throw new Error('Project skill scan is unavailable on the selected device');
    return result;
  }
}

export const projectSkillService = new ProjectSkillService();
