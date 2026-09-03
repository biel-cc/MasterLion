import type {
  DeviceExecutionTarget,
  LobeAgentAgencyConfig,
} from '@lobechat/types/src/agent/agencyConfig';
import type { RuntimeEnvMode } from '@lobechat/types/src/agent/agentConfig';
import type { LobeAgentChatConfig } from '@lobechat/types/src/agent/chatConfig';

import type { ExecutionPlan } from '@lobechat/types/src/executionContext';
import type {
  ExecutionTargetByPlatform,
  TopicExecutionSnapshot,
} from '@lobechat/types/src/projectWorkspace';

export type {
  ExecutionPlan,
  ExecutionPlanUnroutedReason,
} from '@lobechat/types/src/executionContext';

/**
 * The agent's tool mode — explicit `chatConfig.toolMode` wins; otherwise derive
 * from `enableAgentMode` (undefined = agent). `chat` = no execution
 * environment (plain chat); `custom` = toolset is exactly the agent's plugins.
 *
 * Single source of truth so client (selectors), server tools engine, and
 * `resolveExecutionPlan` all agree on what counts as chat mode.
 */
export const resolveToolMode = (
  chatConfig: LobeAgentChatConfig | undefined,
): 'agent' | 'chat' | 'custom' =>
  chatConfig?.toolMode ?? (chatConfig?.enableAgentMode === false ? 'chat' : 'agent');

export interface ResolveExecutionTargetOptions {
  /** Platform-isolated defaults for future topics. */
  executionTargetByPlatform?: ExecutionTargetByPlatform;
  /**
   * Platform of the resolving side. On the server there is no real "desktop"
   * flag — callers pass `gatewayConfigured` as a proxy (a device-gateway
   * deployment serves desktop-class users). See `resolveExecutionPlan`.
   */
  isDesktop: boolean;
  /**
   * Heterogeneous agents (Claude Code / Codex) bring their own toolchain and
   * must bind a workspace before execution. Desktop drafts default local;
   * web drafts remain none until sandbox/device is selected explicitly.
   */
  isHetero?: boolean;
  /** Server-authored topic state. When present it wins over every agent/platform default. */
  topicSnapshot?: TopicExecutionSnapshot;
}

/**
 * Single source of truth for where an agent executes. Existing topic snapshots
 * win; otherwise the current platform slot supplies the default.
 *
 * - `none`    → no execution environment (plain chat)
 * - `local`   → this machine (in-process; desktop only)
 * - `sandbox` → server cloud sandbox
 * - `device`  → remote device (dispatched to `boundDeviceId`)
 *
 * `local` and `device` stay DISTINCT even when the bound device is this very
 * machine: `device` dispatches through the server gateway, so progress streams
 * to every client (mobile/web can follow the run); `local` is the faster
 * in-process IPC path whose run lives only in this desktop session. Which one
 * to use is the user's observability/latency trade-off — never auto-collapse
 * `device(currentDeviceId)` into the in-process path.
 *
 * Defaults: desktop → `local`, web → `none`. The legacy global
 * `agencyConfig.executionTarget` is read only as the web migration slot, so a
 * historical web sandbox cannot contaminate desktop. A local/device target is
 * never coerced to a cloud sandbox; routing availability is handled by
 * `resolveExecutionPlan`.
 */
export const resolveExecutionTarget = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  { executionTargetByPlatform, isDesktop, isHetero, topicSnapshot }: ResolveExecutionTargetOptions,
): DeviceExecutionTarget => {
  if (topicSnapshot) return topicSnapshot.target;

  const platformStored = isDesktop
    ? executionTargetByPlatform?.desktop
    : executionTargetByPlatform?.web;
  const legacyWebTarget = isDesktop ? undefined : agencyConfig?.executionTarget;
  let effective = platformStored ?? legacyWebTarget ?? (isDesktop ? 'local' : 'none');
  if (isHetero && isDesktop && effective === 'none') effective = 'local';
  return effective;
};

/**
 * Derive the `runtimeMode` tool gate from the unified execution target:
 * `local` → local-system tools, `sandbox` → cloud sandbox, `device` → gateway
 * routing, `none` → no run tools (plain chat). `device`/`none` both gate to
 * `'none'` — device tools are routed via `resolveExecutionPlan`, not via
 * runtimeMode.
 */
export const executionTargetToRuntimeMode = (target: DeviceExecutionTarget): RuntimeEnvMode => {
  switch (target) {
    case 'local': {
      return 'local';
    }
    case 'sandbox': {
      return 'cloud';
    }
    default: {
      return 'none';
    }
  }
};

/**
 * The effective `runtimeMode` (server tool gate) from the unified execution
 * target.
 */
export const resolveRuntimeMode = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  isDesktop: boolean,
  options: Pick<ResolveExecutionTargetOptions, 'executionTargetByPlatform' | 'topicSnapshot'> = {},
): RuntimeEnvMode => {
  const target = resolveExecutionTarget(agencyConfig, { ...options, isDesktop });
  // A web client can route a local snapshot through its bound device, but it
  // never gains in-process local tools and must not turn that state into cloud.
  if (!isDesktop && target === 'local') return 'none';
  return executionTargetToRuntimeMode(target);
};

/** Device tools (local-system / remote-device proxy) only exist in device-capable sessions. */
export const isDeviceCapablePlan = (plan: ExecutionPlan): boolean =>
  plan.kind === 'device' || plan.kind === 'device-unrouted';

export interface ResolveExecutionPlanParams {
  agencyConfig: LobeAgentAgencyConfig | undefined;
  /**
   * Verdict of `resolveDeviceAccessPolicy` — `false` (e.g. an external bot
   * sender) kills device routing entirely but does NOT block the sandbox.
   * Defaults to `true` (first-party callers).
   */
  canUseDevice?: boolean;
  /**
   * The agent's chat config. Chat mode (`resolveToolMode` → `chat`) means "no
   * execution environment" — plain chat. It is orthogonal to `executionTarget`:
   * the UI toggle only writes `enableAgentMode` and never touches the target, so
   * a stored/default `local` target would otherwise still resolve a device and
   * `buildStepToolDelta` would re-inject local-system. The plan honours chat
   * mode at the source (degraded to `none`) — except for hetero agents, which
   * always need a runtime.
   */
  chatConfig?: LobeAgentChatConfig;
  executionTargetByPlatform?: ExecutionTargetByPlatform;
  isDesktop: boolean;
  isHetero?: boolean;
  /**
   * Online device ids from the device gateway. Pass `undefined` to skip
   * online checks and single-device auto-activation entirely — the binding is
   * trusted as-is and dispatch fails loudly if the device is offline (hetero
   * dispatch semantics).
   */
  onlineDeviceIds?: string[];
  /**
   * Explicit per-request device override (e.g. the desktop preset, or a
   * batch-task `deviceId`). Always wins: it forces device routing regardless
   * of the stored target.
   */
  requestedDeviceId?: string;
  /** Server-authored topic state; prevents agent defaults from changing an existing topic. */
  topicSnapshot?: TopicExecutionSnapshot;
}

/**
 * Resolve the execution plan for a run. This is THE device decision — every
 * rule about which device (if any) a run touches lives here:
 *
 * 1. `requestedDeviceId` forces device routing; otherwise the resolved
 *    `executionTarget` decides (`local` routes to a device too — the local
 *    machine is just a device).
 * 2. `none` / `sandbox` NEVER route to a device — no auto-activation, no
 *    step-level re-injection, no exceptions.
 * 3. `canUseDevice === false` degrades any device-capable target to `none`
 *    (sandbox stays available — it never touches the user's machines).
 * 4. With online info: a bound device is used only if online (an offline
 *    binding stays unrouted rather than guessing another machine); unbound
 *    runs auto-activate only when EXACTLY ONE device is online.
 */
export const resolveExecutionPlan = (params: ResolveExecutionPlanParams): ExecutionPlan => {
  const {
    agencyConfig,
    canUseDevice = true,
    chatConfig,
    executionTargetByPlatform,
    isDesktop,
    isHetero,
    onlineDeviceIds,
    requestedDeviceId,
    topicSnapshot,
  } = params;

  // Chat mode = no execution environment (plain chat). It's orthogonal to the
  // execution target, so collapse the whole plan to `none` here — this is the
  // single point that stops a default/stored `local` target from resolving a
  // device and letting `buildStepToolDelta` re-inject local-system. Hetero
  // agents always need a runtime, so they never take this path.
  if (resolveToolMode(chatConfig) === 'chat' && !isHetero) return { kind: 'none', target: 'none' };

  const target = resolveExecutionTarget(agencyConfig, {
    executionTargetByPlatform,
    isDesktop,
    isHetero,
    topicSnapshot,
  });
  const wantsDevice = !!requestedDeviceId || target === 'device' || target === 'local';

  if (!wantsDevice || !canUseDevice) {
    if (target === 'sandbox') return { kind: 'sandbox', target: 'sandbox' };
    // Access denial disables device execution. It never turns a local/device
    // intent into a billable cloud run (including heterogeneous agents).
    return { kind: 'none', target: 'none' };
  }

  const boundDeviceId =
    requestedDeviceId ||
    (topicSnapshot ? topicSnapshot.boundDeviceId : agencyConfig?.boundDeviceId);
  // requestedDeviceId may force device routing over a non-device stored target
  const effectiveTarget = target === 'local' ? 'local' : 'device';

  // No online info: trust the binding (the gateway errors on dispatch if the
  // device is offline). No auto-activation without visibility.
  if (!onlineDeviceIds) {
    if (boundDeviceId) return { deviceId: boundDeviceId, kind: 'device', target: effectiveTarget };
    return { kind: 'device-unrouted', reason: 'no-bound-device', target: effectiveTarget };
  }

  if (boundDeviceId) {
    return onlineDeviceIds.includes(boundDeviceId)
      ? { deviceId: boundDeviceId, kind: 'device', target: effectiveTarget }
      : { kind: 'device-unrouted', reason: 'bound-device-offline', target: effectiveTarget };
  }

  // A captured topic is authoritative. If it lacks a device binding, do not
  // guess another online machine (especially when web opens a desktop-local topic).
  if (topicSnapshot) {
    return { kind: 'device-unrouted', reason: 'no-bound-device', target: effectiveTarget };
  }

  if (onlineDeviceIds.length === 1) {
    return { deviceId: onlineDeviceIds[0], kind: 'device', target: effectiveTarget };
  }

  return {
    kind: 'device-unrouted',
    reason: onlineDeviceIds.length === 0 ? 'no-online-device' : 'ambiguous-online-devices',
    target: effectiveTarget,
  };
};
