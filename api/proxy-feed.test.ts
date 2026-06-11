import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockReqRes(method: string, query: Record<string, string | undefined>) {
  const req = { method, query, body: undefined, headers: {} } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as any;
  return { req, res };
}

describe('/api/proxy-feed SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when url is missing', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) protocols', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'file:///etc/passwd' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks loopback addresses (403)', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'http://127.0.0.1/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks the cloud-metadata link-local address (403)', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'http://169.254.169.254/latest/meta-data/' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks private RFC1918 ranges (403)', async () => {
    const { default: handler } = await import('./proxy-feed');
    for (const host of ['http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x']) {
      const { req, res } = createMockReqRes('GET', { url: host });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects public but unlisted domains (403)', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://evil.example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows an allowlisted podcast host', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<?xml version="1.0"?><rss></rss>',
      headers: { get: () => 'application/xml' }
    });
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://feeds.megaphone.fm/show.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
