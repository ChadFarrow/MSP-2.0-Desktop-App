import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Neutralize the reachability guard — see the note in pubnotify.test.ts.
const { mockGuard } = vi.hoisted(() => ({ mockGuard: vi.fn() }));
vi.mock('./_utils/feedReachability.js', () => ({
  guardFeedSubmission: mockGuard,
  wantsForce: (v: unknown) => v === true || v === '1' || v === 'true'
}));

function createMockReqRes(
  method: string,
  query: Record<string, string | undefined>,
  ip = '1.2.3.4'
) {
  const req = {
    method,
    query,
    body: undefined,
    headers: { 'x-forwarded-for': ip }
  } as unknown as VercelRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;

  return { req, res };
}

describe('/api/podping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGuard.mockResolvedValue(null);
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;

    // Reset the rate limiter between tests
    const { __resetRateLimiterForTests } = await import('./_utils/rateLimiter');
    __resetRateLimiterForTests();
  });

  it('rejects non-GET/POST methods with 405', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('DELETE', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when url is missing', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', {});

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for invalid URL format', async () => {
    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'not-a-url' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 501 when PODPING_ENDPOINT_URL is unset', async () => {
    process.env.PODPING_BEARER_TOKEN = 'secret';

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
  });

  it('returns 501 when PODPING_BEARER_TOKEN is unset', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
  });

  it('returns 200 and forwards to hivepinger on success', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', {
      url: 'https://example.com/feed.xml',
      reason: 'update',
      medium: 'music'
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces upstream failure status', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      text: async () => 'down'
    });

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 429 with Retry-After header on the 11th request from same IP', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');

    for (let i = 0; i < 10; i++) {
      const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }

    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('rate-limits per IP independently', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const { default: handler } = await import('./podping');

    for (let i = 0; i < 10; i++) {
      const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' }, '1.1.1.1');
      await handler(req, res);
    }

    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' }, '2.2.2.2');
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The limiter is one shared Map. If this endpoint ever drops its key prefix it
  // starts sharing a bucket with any other unprefixed caller, and the symptom —
  // podping refusing because of traffic somewhere else — looks nothing like the
  // cause. Exhausting the bare-IP key must leave podping untouched.
  it('namespaces its rate-limit key rather than using the bare IP', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const { checkRateLimit } = await import('./_utils/rateLimiter');
    for (let i = 0; i < 10; i++) {
      checkRateLimit('9.9.9.9', { limit: 10, windowMs: 3600_000 });
    }

    const { default: handler } = await import('./podping');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' }, '9.9.9.9');
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('reachability guard', () => {
    it('refuses to podping a feed whose host blocks crawlers', async () => {
      process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
      process.env.PODPING_BEARER_TOKEN = 'secret';
      mockGuard.mockResolvedValue({
        error: "This feed can't be reached — your host returned 403 to our crawler.",
        reachability: { ok: false, status: 403, looksLikeFeed: false, reason: 'blocked' }
      });

      const { default: handler } = await import('./podping');
      const { req, res } = createMockReqRes('GET', { url: 'https://blocked.example.com/feed.xml' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].reachability).toMatchObject({ reason: 'blocked' });
      // No ping was queued, so nothing tells indexers to crawl a feed they can't read.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('forwards force so "Send anyway" can get through', async () => {
      process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
      process.env.PODPING_BEARER_TOKEN = 'secret';
      mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });

      const { default: handler } = await import('./podping');
      const { req, res } = createMockReqRes('GET', { url: 'https://blocked.example.com/feed.xml', force: '1' });
      await handler(req, res);

      expect(mockGuard).toHaveBeenCalledWith(
        'https://blocked.example.com/feed.xml',
        expect.objectContaining({ force: true })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('does not probe when the deployment has no podping configured', async () => {
      const { default: handler } = await import('./podping');
      const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(501);
      expect(mockGuard).not.toHaveBeenCalled();
    });
  });
});
