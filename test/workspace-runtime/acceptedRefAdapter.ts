import { resolveExecutionPlan, resolveExecutionTarget } from '../../src/helpers/executionTarget';
import { missingAcceptanceSeam, type WorkspaceRuntimeAcceptanceAdapter } from './contracts';

export const acceptedRefBoundIds = ['AC-W01', 'AC-W02', 'AC-W03'] as const;

export const acceptedRefMissingSeams = {
  'AC-C01': 'final post-injection context preflight orchestrator with provider-order trace',
  'AC-C02': 'observed-window provider recovery orchestrator and bounded retry counter',
  'AC-C03': 'provider boundary exposing zero-call tail rejection',
  'AC-C04': 'manual compression store action and visible feedback projection',
  'AC-C05': 'transactional summary replacement repository with failure-group trace',
  'AC-C06': 'summary-model-aware chunk planner',
  'AC-C07': 'fingerprint/outcome retry coordinator with provider call counters',
  'AC-C08': 'context error-card projection and redacted diagnostic sink',
  'AC-M01': 'NewApi bridge synchronization entry point returning selectable/default models',
  'AC-M02': 'DB/bridge and API synchronization entry points over the shared classifier',
  'AC-M03': 'model-row accessibility projection independent of development mode',
  'AC-M04': 'catalog merge service exposing manual precedence and drift records',
  'AC-M05': 'model refresh repository transaction preserving evidence metadata',
  'AC-M06': 'client/server operation model snapshot boundary',
  'AC-P01': 'latest direct-user source parser joined to structured read authorization',
  'AC-P02': 'automatic-consent source classifier for every injection-negative source',
  'AC-P03': 'topic grant lifecycle joined to runtime prompt construction',
  'AC-P04': 'clock- and device-scoped exec grant authorization',
  'AC-P05': 'device-side realpath and sensitive-root authorization boundary',
  'AC-P06': 'auto-run path authorization boundary with device/provider counters',
  'AC-P07': 'runCommand spawn preparation exposing cwd override audit',
  'AC-P08': 'consent and shell-risk UI fixture',
  'AC-W04': 'Electron topic/DB/filesystem fixture for five unbound pure-chat turns',
  'AC-W05': 'Topic/Recent/Task navigation fixture with DB and T-n snapshots',
  'AC-W06': 'Workspace-group topic list fixture',
  'AC-W07': 'concurrent scratch initialization service with DB/filesystem observables',
  'AC-W08': 'bind-once service joined to the new-project-topic UI action',
  'AC-W09': 'explicit workspace-topic creation flow plus path-source negative matrix',
  'AC-W10': 'heterogeneous first-send gate and resume identity transport',
  'AC-X01': 'operation trace collector spanning P1/P2/P3/P4 records',
  'AC-X02': 'new/old client-server-device compatibility fixture',
} as const;

/** Accepted-contract binding. Missing methods fail deliberately at call time, never at import. */
export const acceptedRefWorkspaceRuntimeAdapter: WorkspaceRuntimeAcceptanceAdapter = {
  'AC-C01': missingAcceptanceSeam('AC-C01', acceptedRefMissingSeams['AC-C01']),
  'AC-C02': missingAcceptanceSeam('AC-C02', acceptedRefMissingSeams['AC-C02']),
  'AC-C03': missingAcceptanceSeam('AC-C03', acceptedRefMissingSeams['AC-C03']),
  'AC-C04': missingAcceptanceSeam('AC-C04', acceptedRefMissingSeams['AC-C04']),
  'AC-C05': missingAcceptanceSeam('AC-C05', acceptedRefMissingSeams['AC-C05']),
  'AC-C06': missingAcceptanceSeam('AC-C06', acceptedRefMissingSeams['AC-C06']),
  'AC-C07': missingAcceptanceSeam('AC-C07', acceptedRefMissingSeams['AC-C07']),
  'AC-C08': missingAcceptanceSeam('AC-C08', acceptedRefMissingSeams['AC-C08']),
  'AC-M01': missingAcceptanceSeam('AC-M01', acceptedRefMissingSeams['AC-M01']),
  'AC-M02': missingAcceptanceSeam('AC-M02', acceptedRefMissingSeams['AC-M02']),
  'AC-M03': missingAcceptanceSeam('AC-M03', acceptedRefMissingSeams['AC-M03']),
  'AC-M04': missingAcceptanceSeam('AC-M04', acceptedRefMissingSeams['AC-M04']),
  'AC-M05': missingAcceptanceSeam('AC-M05', acceptedRefMissingSeams['AC-M05']),
  'AC-M06': missingAcceptanceSeam('AC-M06', acceptedRefMissingSeams['AC-M06']),
  'AC-P01': missingAcceptanceSeam('AC-P01', acceptedRefMissingSeams['AC-P01']),
  'AC-P02': missingAcceptanceSeam('AC-P02', acceptedRefMissingSeams['AC-P02']),
  'AC-P03': missingAcceptanceSeam('AC-P03', acceptedRefMissingSeams['AC-P03']),
  'AC-P04': missingAcceptanceSeam('AC-P04', acceptedRefMissingSeams['AC-P04']),
  'AC-P05': missingAcceptanceSeam('AC-P05', acceptedRefMissingSeams['AC-P05']),
  'AC-P06': missingAcceptanceSeam('AC-P06', acceptedRefMissingSeams['AC-P06']),
  'AC-P07': missingAcceptanceSeam('AC-P07', acceptedRefMissingSeams['AC-P07']),
  'AC-P08': missingAcceptanceSeam('AC-P08', acceptedRefMissingSeams['AC-P08']),
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
  'AC-W04': missingAcceptanceSeam('AC-W04', acceptedRefMissingSeams['AC-W04']),
  'AC-W05': missingAcceptanceSeam('AC-W05', acceptedRefMissingSeams['AC-W05']),
  'AC-W06': missingAcceptanceSeam('AC-W06', acceptedRefMissingSeams['AC-W06']),
  'AC-W07': missingAcceptanceSeam('AC-W07', acceptedRefMissingSeams['AC-W07']),
  'AC-W08': missingAcceptanceSeam('AC-W08', acceptedRefMissingSeams['AC-W08']),
  'AC-W09': missingAcceptanceSeam('AC-W09', acceptedRefMissingSeams['AC-W09']),
  'AC-W10': missingAcceptanceSeam('AC-W10', acceptedRefMissingSeams['AC-W10']),
  'AC-X01': missingAcceptanceSeam('AC-X01', acceptedRefMissingSeams['AC-X01']),
  'AC-X02': missingAcceptanceSeam('AC-X02', acceptedRefMissingSeams['AC-X02']),
};
