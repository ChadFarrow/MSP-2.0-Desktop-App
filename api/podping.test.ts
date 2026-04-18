import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
  } as any;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as any;

  return { req, res };
}

describe('/api/podping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
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
});
