import { createServer } from 'node:http';
import { Readable } from 'node:stream';

export const serveHono = (fetchHandler: (request: Request) => Response | Promise<Response>, port: number) => {
  const server = createServer(async (request, response) => {
    try {
      const origin = `http://${request.headers.host || `localhost:${port}`}`;
      const method = request.method || 'GET';
      const body = method === 'GET' || method === 'HEAD' ? undefined : Readable.toWeb(request) as ReadableStream;
      const webRequest = new Request(new URL(request.url || '/', origin), {
        body,
        duplex: body ? 'half' : undefined,
        headers: request.headers as HeadersInit,
        method,
      } as RequestInit);
      const result = await fetchHandler(webRequest);
      response.statusCode = result.status;
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'internal_error' }));
    }
  });
  server.listen(port, '0.0.0.0');
  return server;
};
