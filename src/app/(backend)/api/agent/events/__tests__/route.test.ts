// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  getStreamOwner: vi.fn(),
  subscribeStreamEvents: vi.fn(),
  userId: 'owner' as string | null,
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.findById;
  },
}));
vi.mock('../../../../middleware/auth', () => ({
  checkAuth:
    (
      handler: (
        request: Request,
        context: { serverDB: object; userId: string },
      ) => Promise<Response>,
    ) =>
    (request: Request) =>
      mocks.userId
        ? handler(request, { serverDB: {}, userId: mocks.userId })
        : Response.json({}, { status: 401 }),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({ createStreamEventManager: () => mocks }));

const request = (query = 'operationId=op&topicId=topic', headers?: HeadersInit) =>
  new Request(`http://localhost/api/agent/events?${query}`, { headers });
const options = { params: Promise.resolve({}) };

describe('owned operation event stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userId = 'owner';
    mocks.getStreamOwner.mockResolvedValue('owner');
    mocks.findById.mockResolvedValue({ metadata: { runningOperation: { operationId: 'op' } } });
  });
  it('requires authentication and valid parameters', async () => {
    mocks.userId = null;
    expect((await GET(request(), options)).status).toBe(401);
    mocks.userId = 'owner';
    expect((await GET(request('operationId=op'), options)).status).toBe(400);
    expect(
      (await GET(request('operationId=op&topicId=topic&lastEventId=invalid'), options)).status,
    ).toBe(400);
    expect(mocks.subscribeStreamEvents).not.toHaveBeenCalled();
  });
  it.each([undefined, { metadata: { runningOperation: { operationId: 'other' } } }])(
    'does not stream an unowned or unrelated operation',
    async (topic) => {
      mocks.findById.mockResolvedValue(topic);
      mocks.getStreamOwner.mockResolvedValue('other-user');
      expect((await GET(request(), options)).status).toBe(404);
      expect(mocks.subscribeStreamEvents).not.toHaveBeenCalled();
    },
  );
  it('does not trust a client-editable reconnect pointer for stream access', async () => {
    mocks.getStreamOwner.mockResolvedValue('other-user');
    expect((await GET(request(), options)).status).toBe(404);
    expect(mocks.subscribeStreamEvents).not.toHaveBeenCalled();
  });
  it('replays once from the cursor, closes on terminal and releases subscription', async () => {
    mocks.subscribeStreamEvents.mockImplementation(async (_op, _cursor, emit) =>
      emit([
        { id: '100-2', operationId: 'op', type: 'stream_chunk', data: { content: 'hello' } },
        { id: '100-3', operationId: 'op', type: 'agent_runtime_end', data: {} },
        { id: '100-4', operationId: 'op', type: 'stream_chunk', data: { content: 'late' } },
      ]),
    );
    const response = await GET(request(undefined, { 'Last-Event-ID': '100-1' }), options);
    expect(response.status).toBe(200);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const body = await response.text();
    expect(body.match(/hello/g)).toHaveLength(1);
    expect(body).toContain('id: 100-3');
    expect(body).not.toContain('late');
    expect(mocks.subscribeStreamEvents.mock.calls[0][1]).toBe('100-1');
    expect(mocks.subscribeStreamEvents.mock.calls[0][3].aborted).toBe(true);
  });
  it('allows the owner to replay a finished operation after the running pointer is cleared', async () => {
    mocks.findById.mockResolvedValue({ metadata: { runningOperation: null } });
    mocks.getStreamOwner.mockResolvedValue('other-user');
    expect((await GET(request(), options)).status).toBe(404);
    mocks.getStreamOwner.mockResolvedValue('owner');
    mocks.subscribeStreamEvents.mockImplementation(async (_op, _cursor, emit) =>
      emit([{ id: '100-3', operationId: 'op', type: 'agent_runtime_end', data: {} }]),
    );
    const response = await GET(request(), options);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('agent_runtime_end');
  });
  it('cancels subscription when browser closes', async () => {
    mocks.subscribeStreamEvents.mockResolvedValue(undefined);
    const response = await GET(request(), options);
    await response.body!.cancel();
    expect(mocks.subscribeStreamEvents.mock.calls[0][3].aborted).toBe(true);
  });
});
