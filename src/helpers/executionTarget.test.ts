import type { LobeAgentAgencyConfig } from '@lobechat/types/src/agent/agencyConfig';
import type {
  ExecutionTargetByPlatform,
  TopicExecutionSnapshot,
} from '@lobechat/types/src/projectWorkspace';
import { describe, expect, it } from 'vitest';

import {
  executionTargetToRuntimeMode,
  isDeviceCapablePlan,
  resolveExecutionPlan,
  resolveExecutionTarget,
  resolveRuntimeMode,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });
const snapshot = (over: Partial<TopicExecutionSnapshot> = {}): TopicExecutionSnapshot => ({
  target: 'local',
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1,
  ...over,
});

describe('resolveExecutionTarget', () => {
  it('defaults a new desktop topic to local and a new web topic to none', () => {
    expect(resolveExecutionTarget(undefined, { isDesktop: true })).toBe('local');
    expect(resolveExecutionTarget(undefined, { isDesktop: false })).toBe('none');
  });

  it('keeps future-topic defaults isolated by platform', () => {
    const executionTargetByPlatform: ExecutionTargetByPlatform = {
      desktop: 'device',
      web: 'sandbox',
    };

    expect(resolveExecutionTarget(undefined, { executionTargetByPlatform, isDesktop: true })).toBe(
      'device',
    );
    expect(resolveExecutionTarget(undefined, { executionTargetByPlatform, isDesktop: false })).toBe(
      'sandbox',
    );
  });

  it('does not let a legacy web sandbox selection contaminate desktop', () => {
    const legacy = cfg({ executionTarget: 'sandbox' });
    expect(resolveExecutionTarget(legacy, { isDesktop: true })).toBe('local');
    expect(resolveExecutionTarget(legacy, { isDesktop: false })).toBe('sandbox');
  });

  it('preserves local on web instead of silently coercing it to cloud', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'local' }), { isDesktop: false })).toBe(
      'local',
    );
  });

  it('lets an existing topic snapshot override platform and legacy defaults', () => {
    expect(
      resolveExecutionTarget(cfg({ executionTarget: 'device' }), {
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        topicSnapshot: snapshot({ target: 'sandbox' }),
      }),
    ).toBe('sandbox');
  });

  it('keeps an explicit platform none for native agents on desktop and web', () => {
    expect(
      resolveExecutionTarget(undefined, {
        executionTargetByPlatform: { desktop: 'none' },
        isDesktop: true,
      }),
    ).toBe('none');
    expect(
      resolveExecutionTarget(undefined, {
        executionTargetByPlatform: { web: 'none' },
        isDesktop: false,
      }),
    ).toBe('none');
  });

  it('keeps an explicit snapshot none even for a heterogeneous agent', () => {
    expect(
      resolveExecutionTarget(undefined, {
        isDesktop: true,
        isHetero: true,
        topicSnapshot: snapshot({ target: 'none' }),
      }),
    ).toBe('none');
  });

  it('defaults uncaptured heterogeneous topics to desktop local but web none', () => {
    expect(resolveExecutionTarget(undefined, { isDesktop: true, isHetero: true })).toBe('local');
    expect(resolveExecutionTarget(undefined, { isDesktop: false, isHetero: true })).toBe('none');
  });

  it('keeps explicit web heterogeneous sandbox and device selections compatible', () => {
    expect(
      resolveExecutionTarget(undefined, {
        executionTargetByPlatform: { web: 'sandbox' },
        isDesktop: false,
        isHetero: true,
      }),
    ).toBe('sandbox');
    expect(
      resolveExecutionTarget(undefined, {
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
        isHetero: true,
      }),
    ).toBe('device');
  });
});

describe('runtime mode projection', () => {
  it('maps execution targets to runtime tool gates', () => {
    expect(executionTargetToRuntimeMode('local')).toBe('local');
    expect(executionTargetToRuntimeMode('sandbox')).toBe('cloud');
    expect(executionTargetToRuntimeMode('device')).toBe('none');
    expect(executionTargetToRuntimeMode('none')).toBe('none');
  });

  it('does not expose local in-process tools or cloud tools for a web-local snapshot', () => {
    expect(
      resolveRuntimeMode(undefined, false, { topicSnapshot: snapshot({ target: 'local' }) }),
    ).toBe('none');
  });

  it('keeps explicit sandbox compatible on web and desktop snapshots', () => {
    expect(
      resolveRuntimeMode(undefined, false, { executionTargetByPlatform: { web: 'sandbox' } }),
    ).toBe('cloud');
    expect(
      resolveRuntimeMode(undefined, true, { topicSnapshot: snapshot({ target: 'sandbox' }) }),
    ).toBe('cloud');
  });
});

describe('resolveExecutionPlan', () => {
  const onlineA = ['device-a'];
  const onlineAB = ['device-a', 'device-b'];

  it('never routes none to a device', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { desktop: 'none' },
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'none', target: 'none' });
  });

  it('keeps an explicitly selected sandbox mutually exclusive with devices', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { web: 'sandbox' },
        isDesktop: false,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'sandbox', target: 'sandbox' });
  });

  it('respects an existing desktop sandbox snapshot', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        onlineDeviceIds: onlineA,
        topicSnapshot: snapshot({ target: 'sandbox' }),
      }),
    ).toEqual({ kind: 'sandbox', target: 'sandbox' });
  });

  it('uses a bound device when online', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
        onlineDeviceIds: onlineAB,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
  });

  it('keeps a legacy web-local binding on its device without changing the target to cloud', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a', executionTarget: 'local' }),
        isDesktop: false,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
  });

  it('leaves an offline device target unrouted with no cloud fallback', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-x' }),
        executionTargetByPlatform: { desktop: 'device' },
        isDesktop: true,
        onlineDeviceIds: onlineAB,
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'device' });
  });

  it('leaves an unavailable desktop-local snapshot unrouted with no cloud fallback', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ executionTarget: 'sandbox' }),
        isDesktop: true,
        onlineDeviceIds: [],
        topicSnapshot: snapshot({ boundDeviceId: 'device-a', target: 'local' }),
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'bound-device-offline', target: 'local' });
  });

  it('routes a web-opened desktop-local snapshot through its captured device', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: false,
        onlineDeviceIds: onlineA,
        topicSnapshot: snapshot({ boundDeviceId: 'device-a', target: 'local' }),
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
  });

  it('does not guess an online device for a captured local snapshot without a binding', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: false,
        onlineDeviceIds: onlineA,
        topicSnapshot: snapshot({ target: 'local' }),
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' });
  });

  it('auto-activates only one device for an uncaptured desktop draft', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: true,
        onlineDeviceIds: onlineAB,
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'ambiguous-online-devices', target: 'local' });
  });

  it('resolves a new web-native topic to none', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: false,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'none', target: 'none' });
  });

  it('keeps an uncaptured web heterogeneous topic at none until target selection', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: false,
        isHetero: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'none', target: 'none' });
  });

  it('keeps the desktop default local when the web slot is sandbox', () => {
    const executionTargetByPlatform: ExecutionTargetByPlatform = { web: 'sandbox' };
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        executionTargetByPlatform,
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
  });

  it('lets a requested device explicitly override another target', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { web: 'sandbox' },
        isDesktop: false,
        onlineDeviceIds: onlineAB,
        requestedDeviceId: 'device-b',
      }),
    ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
  });

  it('lets a requested device win over an agent-bound device', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
        onlineDeviceIds: onlineAB,
        requestedDeviceId: 'device-b',
      }),
    ).toEqual({ deviceId: 'device-b', kind: 'device', target: 'device' });
  });

  it('never turns access-denied local/device intent into sandbox', () => {
    for (const isHetero of [false, true]) {
      expect(
        resolveExecutionPlan({
          agencyConfig: cfg({ boundDeviceId: 'device-a' }),
          canUseDevice: false,
          executionTargetByPlatform: { desktop: 'local' },
          isDesktop: true,
          isHetero,
          onlineDeviceIds: onlineA,
        }),
      ).toEqual({ kind: 'none', target: 'none' });
    }
  });

  it('keeps an explicitly selected sandbox when device access is denied', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        canUseDevice: false,
        executionTargetByPlatform: { web: 'sandbox' },
        isDesktop: false,
      }),
    ).toEqual({ kind: 'sandbox', target: 'sandbox' });
  });

  it('collapses native chat mode to none without changing a hetero runtime', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        chatConfig: { toolMode: 'chat' },
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'none', target: 'none' });
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        chatConfig: { toolMode: 'chat' },
        executionTargetByPlatform: { web: 'sandbox' },
        isDesktop: false,
        isHetero: true,
      }),
    ).toEqual({ kind: 'sandbox', target: 'sandbox' });
  });

  it('supports the legacy enableAgentMode chat flag and lets explicit toolMode win', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        chatConfig: { enableAgentMode: false },
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ kind: 'none', target: 'none' });
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        chatConfig: { enableAgentMode: false, toolMode: 'agent' },
        executionTargetByPlatform: { desktop: 'local' },
        isDesktop: true,
        onlineDeviceIds: onlineA,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
  });

  it('trusts a captured binding when online visibility is unavailable', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        isDesktop: false,
        topicSnapshot: snapshot({ boundDeviceId: 'device-a', target: 'device' }),
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
  });

  it('also trusts an uncaptured agent binding when online visibility is unavailable', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: cfg({ boundDeviceId: 'device-a' }),
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
      }),
    ).toEqual({ deviceId: 'device-a', kind: 'device', target: 'device' });
  });

  it('keeps an uncaptured unbound device target unrouted without online visibility', () => {
    expect(
      resolveExecutionPlan({
        agencyConfig: undefined,
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
      }),
    ).toEqual({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'device' });
  });

  it('reports only routed/unrouted device plans as device-capable', () => {
    expect(isDeviceCapablePlan({ deviceId: 'device-a', kind: 'device', target: 'local' })).toBe(
      true,
    );
    expect(
      isDeviceCapablePlan({ kind: 'device-unrouted', reason: 'no-bound-device', target: 'device' }),
    ).toBe(true);
    expect(isDeviceCapablePlan({ kind: 'sandbox', target: 'sandbox' })).toBe(false);
    expect(isDeviceCapablePlan({ kind: 'none', target: 'none' })).toBe(false);
  });
});
