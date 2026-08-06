import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('GET /api/healthz', () => {
  it('returns a non-cacheable process health response without dependency details', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('ok');
  });
});
