import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExecutionEnvService from '../executionEnvSrv';

const remoteServer = {
  getAccessToken: vi.fn(async () => 'token-a'),
  getRemoteServerUrl: vi.fn(async () => 'https://masterino.test'),
};

describe('ExecutionEnvService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteServer.getAccessToken.mockResolvedValue('token-a');
    remoteServer.getRemoteServerUrl.mockResolvedValue('https://masterino.test');
  });

  it('fetches resolved values once and caches them for the operation lane', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ result: { data: { json: { TOKEN: 'secret', VISIBLE: 'value' } } } }),
      ok: true,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new ExecutionEnvService({
      getController: vi.fn(() => remoteServer),
    } as any);
    const ref = { agentId: 'agent-a', topicId: 'topic-a', workspaceId: 'workspace-a' };

    await expect(service.resolve(ref)).resolves.toEqual({ TOKEN: 'secret', VISIBLE: 'value' });
    await expect(service.resolve(ref)).resolves.toEqual({ TOKEN: 'secret', VISIBLE: 'value' });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://masterino.test/trpc/lambda/projectWorkspace.getResolvedEnv',
      expect.objectContaining({
        body: JSON.stringify({ json: ref }),
        headers: expect.objectContaining({ 'Oidc-Auth': 'token-a' }),
        method: 'POST',
      }),
    );
  });

  it('fails closed to an empty environment when the server is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    const service = new ExecutionEnvService({
      getController: vi.fn(() => remoteServer),
    } as any);

    await expect(service.resolve({ agentId: 'agent-a' })).resolves.toEqual({});
  });

  it('does not reuse cached plaintext after the desktop authentication scope changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ result: { data: { json: { TOKEN: 'user-a' } } } }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ result: { data: { json: { TOKEN: 'user-b' } } } }),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);
    remoteServer.getAccessToken.mockResolvedValueOnce('token-a').mockResolvedValueOnce('token-b');
    const service = new ExecutionEnvService({
      getController: vi.fn(() => remoteServer),
    } as any);

    await expect(service.resolve({ agentId: 'agent-a' })).resolves.toEqual({ TOKEN: 'user-a' });
    await expect(service.resolve({ agentId: 'agent-a' })).resolves.toEqual({ TOKEN: 'user-b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
