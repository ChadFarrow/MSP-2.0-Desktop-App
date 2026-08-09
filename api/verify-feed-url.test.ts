import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];

function createMockReqRes(method: string, query: Record<string, string | undefined>) {
  const req = { method, query, body: undefined, headers: {} } as never;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as never;
  return { req, res } as { req: never; res: ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>> };
}

/** A Response-alike whose body streams a single chunk. */
function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {}
      })
    },
    text: async () => body
  };
}

function redirectResponse(status: number, location: string | null) {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
    body: null,
    text: async () => ''
  };
}

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

async function loadHandler() {
  const { default: handler } = await import('./verify-feed-url');
  return handler;
}

describe('/api/verify-feed-url', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLookup.mockResolvedValue(PUBLIC_V4);
    const { __resetRateLimiterForTests } = await import('./_utils/rateLimiter');
    __resetRateLimiterForTests();
  });

  it('rejects non-GET methods', async () => {
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('POST', { url: 'https://example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when url is missing', async () => {
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for interior whitespace but accepts a URL with edge whitespace', async () => {
    const handler = await loadHandler();

    const bad = createMockReqRes('GET', { url: 'https://example.com/my feed.xml' });
    await handler(bad.req, bad.res);
    expect(bad.res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(textResponse(RSS));
    const good = createMockReqRes('GET', { url: '  https://example.com/feed.xml\n' });
    await handler(good.req, good.res);
    expect(good.res.status).toHaveBeenCalledWith(200);
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/feed.xml');
  });

  it('returns 403 for a loopback or private address without fetching', async () => {
    const handler = await loadHandler();
    for (const url of ['http://127.0.0.1/feed.xml', 'http://169.254.169.254/latest/']) {
      const { req, res } = createMockReqRes('GET', { url });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 403 when a public hostname resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://evil.example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The bypass a first-hop-only check misses.
  it('blocks a redirect that lands on a private address', async () => {
    mockFetch.mockResolvedValueOnce(redirectResponse(302, 'http://169.254.169.254/latest/meta-data/'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.reachable).toBe(false);
    expect(payload.reason).toMatch(/blocked address/i);
    expect(mockFetch).toHaveBeenCalledTimes(1); // never followed
  });

  it('follows a safe redirect and reports the final URL', async () => {
    mockFetch
      .mockResolvedValueOnce(redirectResponse(301, 'https://example.com/new-feed.xml'))
      .mockResolvedValueOnce(textResponse(RSS));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    expect(res.json.mock.calls[0][0]).toMatchObject({
      reachable: true,
      looksLikeFeed: true,
      finalUrl: 'https://example.com/new-feed.xml'
    });
  });

  it('gives up after too many redirects', async () => {
    mockFetch.mockResolvedValue(redirectResponse(302, 'https://example.com/loop.xml'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);
    expect(res.json.mock.calls[0][0].reason).toMatch(/too many redirects/i);
  });

  it('reports a 404 as reachable:false with the status', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('Not Found', { status: 404 }));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/typo.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ reachable: false, status: 404 });
  });

  it('reports an HTML page as reachable but not feed-shaped', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('<!doctype html><html><body>hi</body></html>'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/index.html' });
    await handler(req, res);

    expect(res.json.mock.calls[0][0]).toMatchObject({ reachable: true, looksLikeFeed: false });
  });

  it('recognises an Atom feed', async () => {
    mockFetch.mockResolvedValueOnce(textResponse('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/atom.xml' });
    await handler(req, res);
    expect(res.json.mock.calls[0][0].looksLikeFeed).toBe(true);
  });

  it('reports a timeout rather than throwing', async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://slow.example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ reachable: false });
    expect(res.json.mock.calls[0][0].reason).toMatch(/timed out/i);
  });

  it('reports a connection failure rather than throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://down.example.com/feed.xml' });
    await handler(req, res);
    expect(res.json.mock.calls[0][0].reachable).toBe(false);
  });

  it('reports an unresolvable host as a verdict, not a refusal', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://nope.example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ reachable: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rate limits after 30 requests in the window', async () => {
    const handler = await loadHandler();
    mockFetch.mockResolvedValue(textResponse(RSS));

    for (let i = 0; i < 30; i++) {
      const { req, res } = createMockReqRes('GET', { url: `https://example.com/feed${i}.xml` });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }

    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed-over.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  // The allowlist is absent on the condition that content never leaves this
  // endpoint. If that ever stops holding, it becomes an open SSRF proxy.
  it('never echoes the fetched body back to the caller', async () => {
    const secret = '<rss><channel><title>INTERNAL SECRET</title></channel></rss>';
    mockFetch.mockResolvedValueOnce(textResponse(secret));
    const handler = await loadHandler();
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain('INTERNAL SECRET');
    expect(res.send).not.toHaveBeenCalled();
  });
});
