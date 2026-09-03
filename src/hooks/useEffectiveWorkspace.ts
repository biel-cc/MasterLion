import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types/src/agent/agencyConfig';
import type {
  ExecutionAccessRoot,
  ExecutionContext,
  ExecutionPlanUnroutedReason,
} from '@lobechat/types/src/executionContext';
import type {
  ExecutionTargetByPlatform,
  TopicExecutionSnapshot,
  WorkspaceKind,
  WorkspaceRef,
} from '@lobechat/types/src/projectWorkspace';
import { useMemo } from 'react';

import { type ExecutionAgencyConfig, resolveExecutionContext } from '@/helpers/executionContext';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import {
  buildDraftConversationKey,
  buildTopicDeviceKey,
  projectWorkspaceSelectors,
  readTopicExecutionSnapshot,
  useProjectWorkspaceStore,
} from '@/store/projectWorkspace';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

export type EffectiveWorkspaceState = 'bound' | 'scratch' | 'unbound' | 'unrouted';

/** Picker recommendations. They are never a cwd and never bind anything. */
export interface WorkspaceRecommendation {
  /** `agencyConfig.workingDirByDevice[deviceId]` or the agent default workspace root. */
  agentDefault?: string;
  /** `devices.defaultCwd` of the target device. */
  deviceDefault?: string;
  deviceId?: string;
}

export interface EffectiveWorkspace {
  /** Full accepted execution context for advanced consumers. */
  context: ExecutionContext;
  /** Resolved primary cwd. `undefined` for unbound/unrouted; never a home/Desktop/process fallback. */
  cwd?: string;
  /** Key of the draft intent record for this conversation container. */
  draftKey: string;
  isDraft: boolean;
  recommendation: WorkspaceRecommendation;
  state: EffectiveWorkspaceState;
  target: DeviceExecutionTarget;
  targetDeviceId?: string;
  topicId?: string;
  unroutedReason?: ExecutionPlanUnroutedReason;
  workspace?: WorkspaceRef;
}

export interface UseEffectiveWorkspaceOptions {
  /** Explicit topic scope. Defaults to the active topic; pass `null` to resolve the draft. */
  topicId?: string | null;
}

interface TransitionalTopicMetadata {
  boundDeviceId?: string;
  workingDirectory?: string;
  workspaceId?: string;
  workspaceKind?: WorkspaceKind;
}

const EMPTY_ROOTS: ExecutionAccessRoot[] = [];

/**
 * The single renderer-side cwd view. It feeds server-authored evidence
 * (topic snapshot, persisted workspaces, topic grants) plus the draft intent
 * into the accepted `resolveExecutionContext` and returns the derived state.
 *
 * Draft intent and device defaults are surfaced as `recommendation` only;
 * the resolved `cwd` comes exclusively from the contract.
 */
export const useEffectiveWorkspace = (
  agentId?: string,
  options: UseEffectiveWorkspaceOptions = {},
): EffectiveWorkspace => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const canFetch = isLogin || isDesktop;

  // Self-populate the stores this view depends on (SWR dedupes by key).
  useDeviceStore((s) => s.useFetchDevices)(canFetch);
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  useProjectWorkspaceStore((s) => s.useFetchWorkspaces)(canFetch);

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const topicId = options.topicId === undefined ? activeTopicId : options.topicId;
  const resolvedTopicId = topicId ?? undefined;

  useProjectWorkspaceStore((s) => s.useFetchTopicState)(resolvedTopicId);

  const topic = useChatStore((s) =>
    resolvedTopicId ? topicSelectors.getTopicById(resolvedTopicId)(s) : undefined,
  );
  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  ) as ExecutionAgencyConfig | undefined;
  const chatConfig = useAgentStore((s) =>
    agentId ? agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig : undefined,
  );
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const devices = useDeviceStore((s) => s.devices);
  const isDevicesInit = useDeviceStore((s) => s.isDevicesInit);

  const draftKey = buildDraftConversationKey({ agentId, groupId: activeGroupId });
  const draft = useProjectWorkspaceStore(projectWorkspaceSelectors.getDraftIntent(draftKey));
  const topicState = useProjectWorkspaceStore(
    projectWorkspaceSelectors.getTopicState(resolvedTopicId),
  );
  const workspacesById = useProjectWorkspaceStore((s) => s.workspacesById);
  const grantsByTopicDevice = useProjectWorkspaceStore((s) => s.grantsByTopicDevice);

  return useMemo<EffectiveWorkspace>(() => {
    const isDraft = !resolvedTopicId;
    const isHetero = !!agencyConfig?.heterogeneousProvider;
    const metadata = topic?.metadata as TransitionalTopicMetadata | undefined;

    const snapshot: TopicExecutionSnapshot | undefined = topic
      ? readTopicExecutionSnapshot(topic, topicState)
      : topicState?.snapshot;

    const legacyTopic = topic
      ? {
          boundDeviceId: metadata?.boundDeviceId,
          workingDirectory: metadata?.workingDirectory,
          workspaceId: metadata?.workspaceId,
        }
      : undefined;

    // A draft target switch only changes this draft's platform slot; it never
    // writes the agent's stored defaults.
    const platformKey: keyof ExecutionTargetByPlatform = isDesktop ? 'desktop' : 'web';
    const executionTargetByPlatform: ExecutionTargetByPlatform | undefined =
      isDraft && draft?.target
        ? { ...agencyConfig?.executionTargetByPlatform, [platformKey]: draft.target }
        : agencyConfig?.executionTargetByPlatform;

    const target = resolveExecutionTarget(agencyConfig, {
      executionTargetByPlatform,
      isDesktop,
      isHetero,
      topicSnapshot: snapshot,
    });

    let requestedDeviceId: string | undefined;
    if (isDraft && draft?.target === 'device' && draft.targetDeviceId) {
      requestedDeviceId = draft.targetDeviceId;
    } else if (target === 'local' && isDesktop && !snapshot?.boundDeviceId) {
      // Local means this machine. Without a gateway id the local target is
      // reported as unavailable rather than guessed.
      requestedDeviceId = currentDeviceId;
    }

    // The desktop app is by definition running on its own device, so it counts
    // as online even before the gateway list reflects it.
    const onlineDeviceIds = isDevicesInit
      ? [
          ...devices.filter((device) => device.online).map((device) => device.deviceId),
          ...(isDesktop && currentDeviceId ? [currentDeviceId] : []),
        ]
      : undefined;

    const workspaces: Record<string, WorkspaceRef | undefined> = { ...workspacesById };
    if (topicState?.workspace?.id && !workspaces[topicState.workspace.id]) {
      workspaces[topicState.workspace.id] = topicState.workspace;
    }

    const initialTopicMetadata =
      isDraft && draft?.workspaceId ? { workspaceId: draft.workspaceId } : undefined;

    const baseInput = {
      agencyConfig,
      canUseDevice: true,
      chatConfig,
      executionTargetByPlatform,
      initialTopicMetadata,
      isDesktop,
      isHetero,
      onlineDeviceIds,
      requestedDeviceId,
      snapshot,
      topic: legacyTopic,
      workspaces,
    };

    // First pass identifies the device so the right topic grants are composed.
    const preliminary = resolveExecutionContext(baseInput);
    const grantDeviceId =
      preliminary.plan.kind === 'device' ? preliminary.plan.deviceId : undefined;
    const grants =
      resolvedTopicId && grantDeviceId
        ? (grantsByTopicDevice[buildTopicDeviceKey(resolvedTopicId, grantDeviceId)] ?? [])
        : [];
    const accessRoots: ExecutionAccessRoot[] =
      grants.length > 0
        ? grants.map((grant) => ({
            grantId: grant.id,
            modes: grant.modes,
            rootPath: grant.rootPath,
            scope: 'topic' as const,
            source: 'user-approval' as const,
          }))
        : EMPTY_ROOTS;

    const context =
      accessRoots.length > 0 ? resolveExecutionContext({ ...baseInput, accessRoots }) : preliminary;

    const plan = context.plan;
    let state: EffectiveWorkspaceState;
    if (plan.kind === 'device-unrouted') state = 'unrouted';
    else if (context.workspace) state = context.workspace.kind === 'scratch' ? 'scratch' : 'bound';
    else state = 'unbound';

    const targetDeviceId = plan.kind === 'device' ? plan.deviceId : undefined;
    const recommendationDeviceId =
      targetDeviceId ??
      requestedDeviceId ??
      snapshot?.boundDeviceId ??
      (isDesktop ? currentDeviceId : agencyConfig?.boundDeviceId);
    const agentDefaultWorkspaceId = recommendationDeviceId
      ? agencyConfig?.defaultWorkspaceByDevice?.[recommendationDeviceId]
      : undefined;
    const recommendation: WorkspaceRecommendation = {
      agentDefault: recommendationDeviceId
        ? (agencyConfig?.workingDirByDevice?.[recommendationDeviceId] ??
          (agentDefaultWorkspaceId ? workspacesById[agentDefaultWorkspaceId]?.rootPath : undefined))
        : undefined,
      deviceDefault: recommendationDeviceId
        ? (devices.find((device) => device.deviceId === recommendationDeviceId)?.defaultCwd ??
          undefined)
        : undefined,
      deviceId: recommendationDeviceId,
    };

    return {
      context,
      cwd: context.cwd,
      draftKey,
      isDraft,
      recommendation,
      state,
      target: plan.target,
      targetDeviceId,
      topicId: resolvedTopicId,
      unroutedReason: plan.kind === 'device-unrouted' ? plan.reason : undefined,
      workspace: context.workspace,
    };
  }, [
    agencyConfig,
    chatConfig,
    currentDeviceId,
    devices,
    draft,
    draftKey,
    grantsByTopicDevice,
    isDevicesInit,
    resolvedTopicId,
    topic,
    topicState,
    workspacesById,
  ]);
};
