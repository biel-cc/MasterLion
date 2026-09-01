import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executionContextService } from './executionContext';

const { close, inspect, prepare } = vi.hoisted(() => ({
  close: vi.fn(),
  inspect: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ executionContext: { close, inspect, prepare } }),
}));

const createSnapshot = () => ({
  createdAt: '2026-09-01T00:00:00.000Z',
  environment: {
    inherited: 'all' as const,
    overriddenKeys: [],
    pathEntryCount: 2,
    removedKeys: [],
  },
  ref: { contextId: 'context-renderer', version: 1 as const },
  runtimePlan: {
    packageManager: 'npm' as const,
    packageManagerCapability: { available: true },
    packageManagerSource: 'default' as const,
    runtime: 'node' as const,
    runtimeCapability: { available: true },
    runtimeSource: 'default' as const,
    status: 'ready' as const,
  },
  workspace: {
    realPath: '/workspace',
    source: 'selected' as const,
    writableRoots: ['/workspace'],
  },
});

describe('executionContextService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deep-freezes the IPC clone before it enters operation state', async () => {
    prepare.mockResolvedValue(createSnapshot());

    const snapshot = await executionContextService.prepare({
      requestedWorkingDirectory: '/workspace',
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.environment.removedKeys)).toBe(true);
    expect(Object.isFrozen(snapshot.ref)).toBe(true);
    expect(Object.isFrozen(snapshot.runtimePlan.packageManagerCapability)).toBe(true);
    expect(Object.isFrozen(snapshot.runtimePlan.runtimeCapability)).toBe(true);
    expect(Object.isFrozen(snapshot.workspace.writableRoots)).toBe(true);
  });

  it('rejects an IPC snapshot that drifts from the shared wire schema', async () => {
    prepare.mockResolvedValue({ ...createSnapshot(), runtimePlan: { runtime: 'node' } });

    await expect(
      executionContextService.prepare({ requestedWorkingDirectory: '/workspace' }),
    ).rejects.toThrow();
  });
});
