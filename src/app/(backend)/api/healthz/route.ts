export const dynamic = 'force-dynamic';

export const GET = async () =>
  new Response('ok', {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
    status: 200,
  });
