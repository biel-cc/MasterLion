import { describe, expect, it } from 'vitest';

import type {
  ExecutionAccessRoot,
  ExecutionEnv,
} from '../../../packages/types/src/executionContext';
import type {
  TopicExecutionSnapshot,
  WorkspaceRef,
} from '../../../packages/types/src/projectWorkspace';

import { buildExecutionAccessRoots } from './accessRoots';
import {
  assertExecutionContextReady,
  resolveExecutionContext,
  toToolCallExecutionContext,
} from './resolveExecutionContext';
import {
  buildWorkspaceScopeKey,
  decideWorkspaceBind,
  isAbsoluteFilesystemPath,
  isSameWorkspace,
  normalizeRootPath,
  normalizeWorkspaceIdentity,
} from './workspaceIdentity';

const snapshot = (over: Partial<TopicExecutionSnapshot> = {}): TopicExecutionSnapshot => ({
  boundDeviceId: 'device-a',
  target: 'local',
  targetCapturedAt: '2026-09-03T00:00:00.000Z',
  version: 1,
  ...over,
});

const workspace = (over: Partial<WorkspaceRef> = {}): WorkspaceRef => ({
  deviceId: 'device-a',
  id: 'workspace-a',
  kind: 'device',
  rootPath: '/code/masterino',
  ...over,
});

describe('workspace identity', () => {
  it('normalizes separators, trailing slashes, and Windows drive casing', () => {
    expect(normalizeRootPath(' /code//masterino/// ')).toBe('/code/masterino');
    expect(normalizeRootPath('C:\\Code\\Masterino\\')).toBe('c:/Code/Masterino');
    expect(normalizeRootPath('/')).toBe('/');
    expect(normalizeRootPath('C:\\')).toBe('c:/');
  });

  it('accepts only absolute filesystem paths, never URLs, slugs, or home shorthand', () => {
    expect(isAbsoluteFilesystemPath('/code/masterino')).toBe(true);
    expect(isAbsoluteFilesystemPath('C:\\Code\\Masterino')).toBe(true);
    expect(isAbsoluteFilesystemPath('https://github.com/acme/repo')).toBe(false);
    expect(isAbsoluteFilesystemPath('acme/repo')).toBe(false);
    expect(isAbsoluteFilesystemPath('~/repo')).toBe(false);
  });

  it('uses persisted ids as the stable identity', () => {
    expect(normalizeWorkspaceIdentity(workspace({ rootPath: '/old' }))).toMatchObject({
      key: 'id:workspace-a',
      workspaceId: 'workspace-a',
    });
    expect(isSameWorkspace(workspace({ rootPath: '/old' }), workspace({ rootPath: '/new' }))).toBe(
      true,
    );
  });

  it('uses normalized kind/device/path identity for legacy workspaces', () => {
    const left = workspace({ id: undefined, rootPath: '/code/masterino/' });
    const right = workspace({ id: undefined, rootPath: '/code//masterino' });
    expect(buildWorkspaceScopeKey(left)).toBe('device:device-a:/code/masterino');
    expect(isSameWorkspace(left, right)).toBe(true);
    expect(isSameWorkspace(workspace(), right)).toBe(true);
    expect(isSameWorkspace(left, { ...right, deviceId: 'device-b' })).toBe(false);
  });

  it('allows first/idempotent binding and rejects every rebind including scratch upgrades', () => {
    const scratch = workspace({ id: 'scratch-a', kind: 'scratch' });
    expect(decideWorkspaceBind(undefined, scratch)).toEqual({
      allowed: true,
      reason: 'first-bind',
    });
    expect(decideWorkspaceBind(scratch, { ...scratch, rootPath: '/different-mirror' })).toEqual({
      allowed: true,
      reason: 'same-workspace',
    });
    expect(decideWorkspaceBind(scratch, workspace())).toEqual({
      allowed: false,
      reason: 'already-bound',
    });
  });
});

describe('buildExecutionAccessRoots', () => {
  const operationRoot: ExecutionAccessRoot = {
    modes: ['read', 'read'],
    rootPath: '/outside/docs/',
    scope: 'operation',
    source: 'direct-user-message',
  };

  it('adds a normalized primary root without changing the supplied cwd', () => {
    expect(buildExecutionAccessRoots('/code/masterino/', [operationRoot])).toEqual([
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/code/masterino',
        scope: 'primary',
        source: 'workspace',
      },
      {
        modes: ['read'],
        rootPath: '/outside/docs',
        scope: 'operation',
        source: 'direct-user-message',
      },
    ]);
  });

  it('keeps operation consent usable on an unbound topic without inventing a primary cwd', () => {
    expect(buildExecutionAccessRoots(undefined, [operationRoot])).toEqual([
      { ...operationRoot, modes: ['read'], rootPath: '/outside/docs' },
    ]);
  });

  it('returns undefined when neither a primary nor additional roots exist', () => {
    expect(buildExecutionAccessRoots(undefined)).toBeUndefined();
  });

  it('replaces a supplied primary duplicate with the canonical primary root', () => {
    expect(
      buildExecutionAccessRoots('/code/masterino', [
        {
          modes: ['read'],
          rootPath: '/code/masterino/',
          scope: 'primary',
          source: 'workspace',
        },
      ]),
    ).toEqual([
      {
        modes: ['read', 'write', 'exec'],
        rootPath: '/code/masterino',
        scope: 'primary',
        source: 'workspace',
      },
    ]);
  });
});

describe('resolveExecutionContext', () => {
  it('keeps a desktop pure-chat topic unbound and creates no scratch path', () => {
    const result = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: ['device-a'],
    });

    expect(result.plan).toEqual({ deviceId: 'device-a', kind: 'device', target: 'local' });
    expect(result).toMatchObject({ unresolvedReason: 'no-workspace', version: 1 });
    expect(result.cwd).toBeUndefined();
    expect(result.workspace).toBeUndefined();
  });

  it('resolves a captured device workspace and derives cwd plus primary access', () => {
    const topicSnapshot = snapshot({ workspaceId: 'workspace-a', workspaceKind: 'device' });
    const result = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: ['device-a'],
      snapshot: topicSnapshot,
      workspaces: { 'workspace-a': workspace({ rootPath: '/code/masterino/' }) },
    });

    expect(result.cwd).toBe('/code/masterino');
    expect(result.workspace).toMatchObject({ id: 'workspace-a', rootPath: '/code/masterino' });
    expect(result.accessRoots?.[0]).toMatchObject({
      rootPath: '/code/masterino',
      scope: 'primary',
    });
    expect(result.unresolvedReason).toBeUndefined();
  });

  it('does not fall through to a legacy path when an authoritative snapshot workspace is missing', () => {
    const result = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: ['device-a'],
      snapshot: snapshot({ workspaceId: 'missing', workspaceKind: 'device' }),
      topic: { boundDeviceId: 'device-a', workingDirectory: '/legacy/path' },
      workspaces: {},
    });

    expect(result.cwd).toBeUndefined();
    expect(result.unresolvedReason).toBe('no-workspace');
  });

  it('accepts a compatible legacy topic path but rejects URL-shaped mirrors', () => {
    expect(
      resolveExecutionContext({
        agencyConfig: { boundDeviceId: 'device-a' },
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
        onlineDeviceIds: ['device-a'],
        topic: { boundDeviceId: 'device-a', workingDirectory: '/legacy/path' },
      }).cwd,
    ).toBe('/legacy/path');
    expect(
      resolveExecutionContext({
        agencyConfig: { boundDeviceId: 'device-a' },
        executionTargetByPlatform: { web: 'device' },
        isDesktop: false,
        onlineDeviceIds: ['device-a'],
        topic: { workingDirectory: 'https://github.com/acme/repo' },
      }).cwd,
    ).toBeUndefined();
  });

  it('uses explicit draft workspace metadata but not agent/device recommendation fallbacks', () => {
    expect(
      resolveExecutionContext({
        agencyConfig: {
          boundDeviceId: 'device-a',
          defaultWorkspaceByDevice: { 'device-a': 'workspace-a' },
          workingDirByDevice: { 'device-a': '/agent/default' },
        },
        initialTopicMetadata: { workspaceId: 'workspace-a' },
        isDesktop: true,
        onlineDeviceIds: ['device-a'],
        workspaces: { 'workspace-a': workspace() },
      }).cwd,
    ).toBe('/code/masterino');

    expect(
      resolveExecutionContext({
        agencyConfig: {
          boundDeviceId: 'device-a',
          defaultWorkspaceByDevice: { 'device-a': 'workspace-a' },
          workingDirByDevice: { 'device-a': '/agent/default' },
        },
        isDesktop: true,
        onlineDeviceIds: ['device-a'],
        workspaces: { 'workspace-a': workspace() },
      }).cwd,
    ).toBeUndefined();
  });

  it('resolves an explicitly selected sandbox to its stable container cwd', () => {
    const result = resolveExecutionContext({
      executionTargetByPlatform: { web: 'sandbox' },
      isDesktop: false,
      workspaces: {},
    });
    expect(result).toMatchObject({
      cwd: '/workspace',
      plan: { kind: 'sandbox', target: 'sandbox' },
      workspace: { kind: 'sandbox', rootPath: '/workspace' },
    });
  });

  it('keeps a new web-native topic target-none', () => {
    expect(resolveExecutionContext({ isDesktop: false })).toMatchObject({
      plan: { kind: 'none', target: 'none' },
      unresolvedReason: 'target-none',
    });
  });

  it('preserves additional roots without deriving cwd from them', () => {
    const accessRoot: ExecutionAccessRoot = {
      modes: ['read'],
      rootPath: '/explicit/read',
      scope: 'operation',
      source: 'direct-user-message',
    };
    const result = resolveExecutionContext({ accessRoots: [accessRoot], isDesktop: false });
    expect(result.cwd).toBeUndefined();
    expect(result.accessRoots).toEqual([accessRoot]);
  });

  it('returns the local-specific visible error for an unavailable desktop snapshot', () => {
    const result = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: [],
      snapshot: snapshot({ target: 'local' }),
    });
    expect(assertExecutionContextReady(result, { requireWorkspace: true })).toMatchObject({
      code: 'LOCAL_TARGET_UNAVAILABLE',
      unroutedReason: 'bound-device-offline',
    });
  });

  it('returns device-unrouted and workspace-required as distinct errors', () => {
    const deviceResult = resolveExecutionContext({
      agencyConfig: { boundDeviceId: 'device-x' },
      executionTargetByPlatform: { web: 'device' },
      isDesktop: false,
      onlineDeviceIds: [],
    });
    expect(assertExecutionContextReady(deviceResult, { requireWorkspace: true })?.code).toBe(
      'DEVICE_UNROUTED',
    );

    const noWorkspace = resolveExecutionContext({
      isDesktop: true,
      onlineDeviceIds: ['device-a'],
    });
    expect(assertExecutionContextReady(noWorkspace, { requireWorkspace: true })?.code).toBe(
      'WORKSPACE_REQUIRED',
    );
    expect(assertExecutionContextReady(noWorkspace, { requireWorkspace: false })).toBeUndefined();
  });

  it('omits env values by default and includes them only for an explicit server/device projection', () => {
    const env: ExecutionEnv = {
      secretKeys: ['TOKEN'],
      sources: { TOKEN: 'workspace' },
      values: { TOKEN: 'secret' },
    };
    const result = resolveExecutionContext({ env, isDesktop: false });
    expect(toToolCallExecutionContext(result).env).toBeUndefined();
    expect(toToolCallExecutionContext(result, { includeEnvValues: true }).env).toEqual({
      TOKEN: 'secret',
    });
  });
});
