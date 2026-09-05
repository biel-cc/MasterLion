import { resolveExecutionPlan, resolveExecutionTarget } from '../../src/helpers/executionTarget';
import type { WorkspaceRuntimeAcceptanceAdapter } from './contracts';
import { workspaceRuntimeProductionAcceptanceAdapter } from './productionAdapter';

export const acceptedRefBoundIds = [
  'AC-W01',
  'AC-W02',
  'AC-W03',
  ...Object.keys(workspaceRuntimeProductionAcceptanceAdapter),
] as const;

export const acceptedRefMissingSeams = {} as const;

/** Every acceptance row is bound to a production seam; fixtures supply only external ports. */
export const acceptedRefWorkspaceRuntimeAdapter: WorkspaceRuntimeAcceptanceAdapter = {
  ...workspaceRuntimeProductionAcceptanceAdapter,
  'AC-W01': async () => ({
    draftTarget: resolveExecutionTarget(undefined, { isDesktop: true }),
  }),
  'AC-W02': async () => {
    const platformDefaults = { web: 'sandbox' as const };
    return {
      desktopDraftTarget: resolveExecutionTarget(undefined, {
        executionTargetByPlatform: platformDefaults,
        isDesktop: true,
      }),
      persistedDesktopTarget: resolveExecutionTarget(undefined, {
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        topicSnapshot: {
          target: 'sandbox',
          targetCapturedAt: '2026-09-03T00:00:00.000Z',
          version: 1,
        },
      }),
      webDraftTarget: resolveExecutionTarget(undefined, {
        executionTargetByPlatform: platformDefaults,
        isDesktop: false,
      }),
    };
  },
  'AC-W03': async () => {
    const localPlan = resolveExecutionPlan({
      agencyConfig: undefined,
      isDesktop: true,
      onlineDeviceIds: [],
      topicSnapshot: {
        boundDeviceId: 'device-a',
        target: 'local',
        targetCapturedAt: '2026-09-03T00:00:00.000Z',
        version: 1,
      },
    });
    const devicePlan = resolveExecutionPlan({
      agencyConfig: { boundDeviceId: 'device-a' },
      executionTargetByPlatform: { desktop: 'device' },
      isDesktop: true,
      onlineDeviceIds: [],
    });
    return {
      devicePlanKind: devicePlan.kind,
      deviceTarget: devicePlan.target,
      localPlanKind: localPlan.kind,
      localTarget: localPlan.target,
    };
  },
};
