import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSandboxService: vi.fn(() => ({ kind: 'onlyboxes' })),
  marketServiceConstructor: vi.fn(),
  sandboxRuntimeConstructor: vi.fn((service) => ({ service })),
}));

vi.mock('@lobechat/builtin-tool-cloud-sandbox', () => ({
  CloudSandboxExecutionRuntime: mocks.sandboxRuntimeConstructor,
  CloudSandboxIdentifier: 'lobe-cloud-sandbox',
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({ id: 'file-service' })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: mocks.marketServiceConstructor,
}));

vi.mock('@/server/services/sandbox', () => ({
  createSandboxService: mocks.createSandboxService,
}));

describe('cloudSandboxRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the sandbox without initializing Market', async () => {
    const { cloudSandboxRuntime } = await import('../cloudSandbox');

    await cloudSandboxRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(mocks.marketServiceConstructor).not.toHaveBeenCalled();
    expect(mocks.createSandboxService).toHaveBeenCalledWith(
      expect.not.objectContaining({ marketService: expect.anything() }),
    );
  });
});
