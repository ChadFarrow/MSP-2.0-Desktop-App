import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { __resetRateLimiterForTests } from './_utils/rateLimiter.js';

// The WordPress plugin build runs on each artist's own site and calls these
// endpoints cross-origin. Every one must answer the preflight and put
// `Access-Control-Allow-Origin: *` on its real responses too — error responses
// included, or the browser hides the server's message behind "Failed to fetch".

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;

const ENDPOINTS: Array<{ name: string; load: () => Promise<{ default: Handler }>; wrongMethod: string }> = [
  { name: 'pisearch', load: () => import('./pisearch.js'), wrongMethod: 'DELETE' },
  { name: 'pisubmit', load: () => import('./pisubmit.js'), wrongMethod: 'GET' },
  { name: 'pubnotify', load: () => import('./pubnotify.js'), wrongMethod: 'POST' },
  { name: 'podping', load: () => import('./podping.js'), wrongMethod: 'DELETE' },
  { name: 'podping-verify', load: () => import('./podping-verify.js'), wrongMethod: 'POST' },
  { name: 'verify-feed-url', load: () => import('./verify-feed-url.js'), wrongMethod: 'POST' },
  { name: 'account/feeds', load: () => import('./account/feeds.js'), wrongMethod: 'POST' },
  { name: 'auth/magic-link', load: () => import('./auth/magic-link.js'), wrongMethod: 'GET' },
  { name: 'auth/verify', load: () => import('./auth/verify.js'), wrongMethod: 'GET' },
  { name: 'hosted (index)', load: () => import('./hosted/index.js'), wrongMethod: 'DELETE' },
];

function mock(method: string, query: Record<string, string> = {}) {
  const headers = new Map<string, string>();
  const req = {
    method,
    query,
    body: {},
    headers: { origin: 'https://artist.example', 'x-forwarded-for': '203.0.113.9' },
  } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, String(value));
      return res;
    }),
  } as unknown as VercelResponse & { status: ReturnType<typeof vi.fn> };
  return { req, res, headers };
}

describe('public CORS on endpoints the WordPress plugin calls', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint.name}: answers the preflight from any origin`, async () => {
      const { default: handler } = await endpoint.load();
      const { req, res, headers } = mock('OPTIONS');
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    });

    it(`${endpoint.name}: keeps the header on an error response`, async () => {
      const { default: handler } = await endpoint.load();
      const { req, res, headers } = mock(endpoint.wrongMethod);
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  }

  it('hosted/[feedId]: CORS on PUT/DELETE errors, not only on the preflight', async () => {
    const { default: handler } = await import('./hosted/[feedId].js');
    const { req, res, headers } = mock('PUT', { feedId: 'not-a-uuid' });
    await handler(req, res);
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    const allowed = mock('OPTIONS', { feedId: 'x' });
    await handler(allowed.req, allowed.res);
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('X-Email-Session');
  });
});

describe('Podcast Index rate limits', () => {
  beforeEach(() => {
    __resetRateLimiterForTests();
    delete process.env.PODCASTINDEX_API_KEY;
    delete process.env.PODCASTINDEX_API_SECRET;
  });

  it('pisearch refuses the 301st search in an hour from one address', async () => {
    const { default: handler } = await import('./pisearch.js');
    for (let i = 0; i < 300; i++) {
      const { req, res } = mock('GET', { q: 'anything' });
      await handler(req, res);
      // No credentials in tests, so an allowed call stops at the 500 after the limit.
      expect(res.status).not.toHaveBeenCalledWith(429);
    }
    const { req, res, headers } = mock('GET', { q: 'anything' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(headers.get('Retry-After')).toBeTruthy();
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
