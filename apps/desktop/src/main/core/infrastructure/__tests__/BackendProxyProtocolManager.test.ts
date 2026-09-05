import { AUTH_REQUIRED_HEADER } from '@lobechat/desktop-bridge';
import { BrowserWindow, session as electronSession } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendProxyProtocolManager } from '../BackendProxyProtocolManager';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

interface RequestInitWithDuplex extends RequestInit {
  duplex?: 'half';
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInitWithDuplex) => Promise<Response>;

vi.mock('electron-is', () => ({
  dev: vi.fn(() => false),
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
  linux: vi.fn(() => true),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
  net: {
    fetch: vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      global.fetch(input as any, init as any),
    ),
  },
  session: {
    defaultSession: {},
  },
}));

describe('BackendProxyProtocolManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rewrites url to remote base and injects Oidc-Auth via proxy()', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn<FetchMock>(async () => {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain' },
        status: 200,
        statusText: 'OK',
      });
    });
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => 'token-123',
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      isAuthActiveForUrl: async () => true,
      source: 'main',
    });

    const response = await manager.proxy(
      {
        headers: new Headers({ 'Origin': 'app://renderer', 'X-Test': '1' }),
        method: 'GET',
        url: 'app://renderer/trpc/hello?batch=1',
      } as any,
      session,
    );

    expect(response).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('https://remote.example.com/trpc/hello?batch=1');
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected fetch init to be defined');

    expect(init.method).toBe('GET');
    const headers = init.headers as Headers;
    expect(headers.get('Oidc-Auth')).toBe('token-123');
    expect(headers.get('X-Test')).toBe('1');

    expect(response!.status).toBe(200);
    expect(response!.headers.get('X-Src-Url')).toBe(
      'https://remote.example.com/trpc/hello?batch=1',
    );
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('app://renderer');
    expect(response!.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await response!.text()).toBe('ok');
  });

  it('does not inject a previous server token while the target login is inactive', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;
    const getAccessToken = vi.fn().mockResolvedValue('server-a-token');
    const isAuthActiveForUrl = vi.fn().mockResolvedValue(false);
    const fetchMock = vi.fn<FetchMock>(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken,
      getRemoteBaseUrl: async () => 'https://server-b.example.com',
      isAuthActiveForUrl,
    });

    await manager.proxy(
      {
        headers: new Headers(),
        method: 'GET',
        url: 'app://renderer/trpc/hello',
      } as any,
      session,
    );

    expect(getAccessToken).not.toHaveBeenCalled();
    expect(isAuthActiveForUrl).toHaveBeenCalledWith('https://server-b.example.com/trpc/hello');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has('Oidc-Auth')).toBe(false);
  });

  it('forwards body and sets duplex for non-GET requests', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn<FetchMock>(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
    });

    await manager.proxy(
      {
        headers: new Headers(),
        method: 'POST',
        // body doesn't have to be a real stream for this unit test; manager only checks truthiness
        body: 'payload' as any,
        url: 'app://renderer/api/upload',
      } as any,
      session,
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected fetch init to be defined');

    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect(init.duplex).toBe('half');
  });

  it('returns null when remote base url is missing', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => 'token',
      getRemoteBaseUrl: async () => null,
    });

    const res = await manager.proxy(
      { method: 'GET', headers: new Headers(), url: 'app://renderer/trpc' } as any,
      session,
    );

    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when request url is already the remote origin', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
    });

    const res = await manager.proxy(
      {
        method: 'GET',
        headers: new Headers(),
        url: 'https://remote.example.com/trpc/hello?x=1',
      } as any,
      session,
    );

    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when rewrite fails (invalid remote base url)', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'not-a-url',
    });

    const res = await manager.proxy(
      { method: 'GET', headers: new Headers(), url: 'app://renderer/trpc' } as any,
      session,
    );

    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when upstream fetch throws', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
    });

    await expect(
      manager.proxy(
        {
          headers: new Headers(),
          method: 'GET',
          url: 'app://renderer/trpc/hello',
        } as any,
        session,
      ),
    ).rejects.toThrow('network down');
  });

  it('broadcasts authorizationRequired when X-Auth-Required is set on HTTP 207 (batched tRPC)', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as any);

    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const headers = new Headers({
      [AUTH_REQUIRED_HEADER]: 'true',
      'Content-Type': 'application/json',
    });
    const fetchMock = vi.fn<FetchMock>(
      async () => new Response('[]', { headers, status: 207, statusText: 'Multi-Status' }),
    );
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
    });

    await manager.proxy(
      {
        headers: new Headers(),
        method: 'GET',
        url: 'app://renderer/trpc/lambda/batch?batch=1',
      } as any,
      session,
    );

    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith(
      'authorizationRequired',
      expect.objectContaining({
        reason: expect.stringContaining('status=207'),
      }),
    );
  });

  it('captures www-authenticate, body snippet and hadToken in reason on 401', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { isDestroyed: () => false, webContents: { send } },
    ] as any);

    const manager = new BackendProxyProtocolManager();
    const session = {} as any;

    const upstreamBody = JSON.stringify({
      error: { json: { data: { code: 'UNAUTHORIZED' }, message: 'token expired at 2026-06-09' } },
    });
    const headers = new Headers({
      [AUTH_REQUIRED_HEADER]: 'true',
      'Content-Type': 'application/json',
      'www-authenticate': 'Bearer error="invalid_token", error_description="expired"',
    });
    const fetchMock = vi.fn<FetchMock>(
      async () => new Response(upstreamBody, { headers, status: 401, statusText: 'Unauthorized' }),
    );
    vi.stubGlobal('fetch', fetchMock as any);

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => 'fake-token',
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      isAuthActiveForUrl: async () => true,
    });

    const response = await manager.proxy(
      {
        headers: new Headers(),
        method: 'POST',
        url: 'app://renderer/trpc/lambda/me',
      } as any,
      session,
    );

    // Original body is still readable by the downstream caller — clone() must not consume it.
    expect(await response!.text()).toBe(upstreamBody);

    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0];
    expect(payload.reason).toContain('status=401');
    expect(payload.reason).toContain('POST /trpc/lambda/me');
    expect(payload.reason).toContain('hadToken=true');
    expect(payload.reason).toContain('wwwAuth=Bearer error="invalid_token"');
    expect(payload.reason).toContain('UNAUTHORIZED');
    expect(payload.reason).toContain('token expired');
  });

  describe('createAppRequestInterceptor', () => {
    it('returns null for non-backend paths', async () => {
      const manager = new BackendProxyProtocolManager();
      const interceptor = manager.createAppRequestInterceptor();

      const res = await interceptor({
        headers: new Headers(),
        method: 'GET',
        url: 'app://renderer/settings',
      } as any);

      expect(res).toBeNull();
    });

    it('returns 502 for backend paths when default session has no context', async () => {
      // electronSession.defaultSession is the empty {} mock; no register() was called.
      void electronSession.defaultSession;

      const manager = new BackendProxyProtocolManager();
      const interceptor = manager.createAppRequestInterceptor();

      const res = await interceptor({
        headers: new Headers(),
        method: 'GET',
        url: 'app://renderer/trpc/hello',
      } as any);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(502);
    });

    it('proxies backend paths through the registered default-session context', async () => {
      const fetchMock = vi.fn<FetchMock>(async () => new Response('proxied', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock as any);

      const manager = new BackendProxyProtocolManager();
      manager.registerWithRemoteBaseUrl(electronSession.defaultSession as any, {
        getAccessToken: async () => null,
        getRemoteBaseUrl: async () => 'https://remote.example.com',
      });

      const interceptor = manager.createAppRequestInterceptor();
      const res = await interceptor({
        headers: new Headers(),
        method: 'GET',
        url: 'app://renderer/trpc/hello?batch=1',
      } as any);

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      expect(await res!.text()).toBe('proxied');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://remote.example.com/trpc/hello?batch=1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('proxies agent event streams to the authenticated backend instead of Vite', async () => {
      const fetchMock = vi.fn<FetchMock>(
        async () =>
          new Response('data: {}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock as any);
      const manager = new BackendProxyProtocolManager();
      manager.registerWithRemoteBaseUrl(electronSession.defaultSession as any, {
        getAccessToken: async () => 'synthetic-token',
        getRemoteBaseUrl: async () => 'https://remote.example.com',
        isAuthActiveForUrl: async () => true,
      });
      const res = await manager.createAppRequestInterceptor()(
        new Request('app://renderer/api/agent/events?operationId=op&topicId=topic&lastEventId=0'),
      );
      expect(res).not.toBeNull();
      expect(res!.headers.get('Content-Type')).toBe('text/event-stream');
      expect(await res!.text()).toBe('data: {}\n\n');
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        'https://remote.example.com/api/agent/events?operationId=op&topicId=topic&lastEventId=0',
      );
      expect(new Headers(init?.headers).get('Oidc-Auth')).toBe('synthetic-token');
    });

    it('proxies the object-storage upload endpoint with query, content type, and body intact', async () => {
      let forwardedBody: Uint8Array | undefined;
      const fetchMock = vi.fn<FetchMock>(async (_input, init) => {
        forwardedBody = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
        return new Response('uploaded', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock as any);

      const manager = new BackendProxyProtocolManager();
      manager.registerWithRemoteBaseUrl(electronSession.defaultSession as any, {
        getAccessToken: async () => null,
        getRemoteBaseUrl: async () => 'https://remote.example.com',
      });

      const uploadBody = new Uint8Array([80, 75, 3, 4, 222, 173, 190, 239]);
      const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const interceptor = manager.createAppRequestInterceptor();
      const res = await interceptor(
        new Request(
          'app://renderer/api/upload/s3-proxy?key=files%2Finventory.xlsx&expires=3600&signature=sig',
          {
            body: uploadBody,
            headers: new Headers({ 'Content-Type': contentType }),
            method: 'PUT',
          },
        ),
      );

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, init] = fetchMock.mock.calls[0]!;
      expect(calledUrl).toBe(
        'https://remote.example.com/api/upload/s3-proxy?key=files%2Finventory.xlsx&expires=3600&signature=sig',
      );
      expect(init).toBeDefined();
      if (!init) throw new Error('Expected fetch init to be defined');

      expect(init.method).toBe('PUT');
      expect(new Headers(init.headers).get('Content-Type')).toBe(contentType);
      expect(forwardedBody).toEqual(uploadBody);
      expect(init.duplex).toBe('half');
      expect(res!.headers.get('X-Src-Url')).toBe('https://remote.example.com/api/upload/s3-proxy');
      expect(mockLogger.debug).toHaveBeenCalled();
      expect(JSON.stringify(mockLogger.debug.mock.calls)).not.toContain('signature=sig');
    });

    it.each([
      '/api/upload/s3-proxy/extra',
      '/api/upload/s3-proxy-lookalike',
      '/api/agent/events-extra',
      '/api/agent/events/extra',
    ])('does not proxy non-existent upload endpoint %s', async (pathname) => {
      const fetchMock = vi.fn<FetchMock>(async () => new Response('unexpected'));
      vi.stubGlobal('fetch', fetchMock as any);

      const manager = new BackendProxyProtocolManager();
      manager.registerWithRemoteBaseUrl(electronSession.defaultSession as any, {
        getAccessToken: async () => null,
        getRemoteBaseUrl: async () => 'https://remote.example.com',
      });

      const response = await manager.createAppRequestInterceptor()(
        new Request(`app://renderer${pathname}`),
      );

      expect(response).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
