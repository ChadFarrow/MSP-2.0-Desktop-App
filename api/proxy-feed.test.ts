import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Desktop policy note: unlike the web repo's domain allowlist, this proxy
// accepts ANY public http(s) host (import-by-URL needs arbitrary feeds) and
// blocks private/reserved targets with 400. See api/_utils/urlSafety.ts.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => {
  const mod = { lookup: (...args: unknown[]) => mockLookup(...args) };
  return { ...mod, default: mod };
});

function createMockReqRes(method: string, query: Record<string, string | undefined>) {
  const req = { method, query, body: undefined, headers: {} } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;
  return { req, res };
}

describe('/api/proxy-feed SSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
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

  it('blocks loopback addresses', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'http://127.0.0.1/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks the cloud-metadata link-local address', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'http://169.254.169.254/latest/meta-data/' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks private RFC1918 ranges', async () => {
    const { default: handler } = await import('./proxy-feed');
    for (const host of ['http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x']) {
      const { req, res } = createMockReqRes('GET', { url: host });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks localhost hostnames', async () => {
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'http://localhost:3000/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://rebind.example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows arbitrary public hosts (import-by-URL)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<?xml version="1.0"?><rss></rss>',
      headers: new Headers({ 'content-type': 'application/xml' })
    });
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://some-unlisted-site.example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows allowlist-era podcast hosts the same way', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<?xml version="1.0"?><rss></rss>',
      headers: new Headers({ 'content-type': 'application/xml' })
    });
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://feeds.megaphone.fm/show.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses oversized responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'x',
      headers: new Headers({ 'content-length': String(10 * 1024 * 1024) })
    });
    const { default: handler } = await import('./proxy-feed');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/huge.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(413);
  });
});
