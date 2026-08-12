import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// The handler now resolves hostnames (assertPublicHttpUrl), so DNS must be
// mocked — the old allowlist-based version only used the sync literal check.
const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

import { __resetRateLimiterForTests } from './_utils/rateLimiter.js';

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
const SELF_HOSTED = 'https://headstarts.uk/msp/publisher-feeds/James_Goulding.xml';

/** The subset of VercelResponse the handler touches, with vi.fn() assertions. */
type MockRes = VercelResponse & {
  status: Mock;
  json: Mock;
  send: Mock;
  end: Mock;
  setHeader: Mock;
};

function createMockReqRes(
  method: string,
  query: Record<string, string | undefined>,
  headers: Record<string, string> = {}
) {
  const req = { method, query, body: undefined, headers } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as MockRes;
  return { req, res };
}

/**
 * Per-URL *factories*, not a queue and not a shared object — a Response-alike's
 * reader is single-use, so reusing one instance hands the next read an empty
 * body. Same reasoning as feedProbe.test.ts.
 */
function serve(map: Record<string, () => unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    const make = map[url];
    if (!make) throw new Error(`unexpected fetch: ${url}`);
    return make();
  });
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string>; chunkSize?: number } = {}
) {
  const bytes = new TextEncoder().encode(body);
  const chunkSize = init.chunkSize ?? bytes.byteLength;
  let offset = 0;
  const cancel = vi.fn(async () => {});
  const response = {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.byteLength) return { done: true, value: undefined };
          const chunk = bytes.slice(offset, offset + chunkSize);
          offset += chunk.byteLength;
          return { done: false, value: chunk };
        },
        cancel
      })
    },
    text: async () => body
  };
  return Object.assign(response, { cancel });
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

/** Every argument handed to res.send / res.json, flattened to a string. */
function allResponseBodies(res: MockRes): string {
  return [...res.send.mock.calls, ...res.json.mock.calls]
    .flat()
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .join('\n');
}

function headerValue(res: MockRes, name: string): unknown {
  const call = [...res.setHeader.mock.calls].reverse().find((c) => c[0] === name);
  return call?.[1];
}

describe('/api/proxy-feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    __resetRateLimiterForTests();
    mockLookup.mockResolvedValue(PUBLIC_V4);
  });

  describe('input validation', () => {
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

    it('rejects URLs with embedded credentials before fetching', async () => {
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: 'https://user:pass@example.com/feed.xml' });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not apply the Podcast Index character rules — an apostrophe is still fetchable', async () => {
      const url = "https://headstarts.uk/msp/Right_Said_Fred/I'm%20a%20celebrity/feed.xml";
      serve({ [url]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('SSRF guards', () => {
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

    it('blocks a public hostname that resolves to a private address (403)', async () => {
      mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: 'https://rebind.example.com/feed.xml' });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('re-checks every redirect hop and never fetches the blocked target', async () => {
      const start = 'https://example.com/feed.xml';
      const metadata = 'http://169.254.169.254/latest/meta-data/';
      serve({
        [start]: () => redirectResponse(302, metadata),
        [metadata]: () => textResponse('secrets')
      });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: start });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockFetch.mock.calls.every((c) => c[0] === start)).toBe(true);
      expect(allResponseBodies(res)).not.toContain('secrets');
    });

    it('gives up after 10 redirects', async () => {
      const url = (n: number) => `https://example.com/${n}`;
      const map: Record<string, () => unknown> = {};
      for (let i = 0; i <= 20; i++) map[url(i)] = () => redirectResponse(302, url(i + 1));
      serve(map);
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: url(0) });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'too-many-redirects' }));
    });

    it('follows a 6-hop chain that the shared 5-hop default would have refused', async () => {
      // Shared hosting really does chain http → https → www → trailing-slash →
      // CDN → region. safeFetch's default of 5 suits verify-feed-url's 4 s
      // budget; refusing a working feed here would be a false positive, and the
      // endpoint this replaced used Node's `redirect: 'follow'` default of 20.
      const url = (n: number) => `https://example.com/hop${n}`;
      const map: Record<string, () => unknown> = {};
      for (let i = 0; i < 6; i++) map[url(i)] = () => redirectResponse(302, url(i + 1));
      map[url(6)] = () => textResponse(RSS);
      serve(map);
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: url(0) });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(RSS);
    });

    it('strips credentials from a redirect target instead of relaying them', async () => {
      // The handler rejects userinfo on the URL it is handed, but new URL(location,
      // current) carries it through — and Node's fetch turns it into an
      // Authorization header. Without stripping, one redirect defeats that guard.
      const start = 'https://example.com/start.xml';
      serve({
        [start]: () => redirectResponse(302, 'https://user:pass@example.com/real.xml'),
        'https://example.com/real.xml': () => textResponse(RSS)
      });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: start });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const fetched = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(fetched).toContain('https://example.com/real.xml');
      expect(fetched.some((u) => u.includes('user:pass'))).toBe(false);
    });
  });

  describe('the allowlist is gone', () => {
    it('fetches a self-hosted domain that was never on the allowlist', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(RSS);
    });

    it('still fetches a previously allowlisted host', async () => {
      const url = 'https://feeds.megaphone.fm/show.xml';
      serve({ [url]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('body guards', () => {
    it('refuses an HTML page without sending any of it', async () => {
      const html = '<!doctype html><html><body>totally not a feed</body></html>';
      serve({ [SELF_HOSTED]: () => textResponse(html) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.send).not.toHaveBeenCalled();
      expect(allResponseBodies(res)).not.toContain('totally not a feed');
    });

    it('refuses a page whose only feed marker sits past the sniff window', async () => {
      const html = `<!doctype html>${'<p>filler</p>'.repeat(8000)}<!-- <rss --></html>`;
      expect(html.length).toBeGreaterThan(64 * 1024);
      serve({ [SELF_HOSTED]: () => textResponse(html, { chunkSize: 8192 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(res.send).not.toHaveBeenCalled();
    });

    it('refuses an oversized body rather than serving it truncated', async () => {
      const huge = `<rss>${'x'.repeat(6 * 1024 * 1024)}</rss>`;
      serve({ [SELF_HOSTED]: () => textResponse(huge, { chunkSize: 512 * 1024 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.send).not.toHaveBeenCalled();
    });

    it('refuses below Vercel’s 4.5 MB response ceiling, not above it', async () => {
      // Vercel kills any function response over 4.5 MB with its own opaque
      // FUNCTION_PAYLOAD_TOO_LARGE. Our cap has to fire first or the user gets a
      // 413 with nothing explaining it and no hint about importing the file.
      // A 4.4 MB feed must therefore already be refused *by us*.
      const big = `<rss>${'x'.repeat(4_400_000)}</rss>`;
      serve({ [SELF_HOSTED]: () => textResponse(big, { chunkSize: 256 * 1024 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(allResponseBodies(res)).toMatch(/import it as a file/i);
    });

    it('serves a feed comfortably under the cap', async () => {
      const ok = `<rss><channel>${'<item>x</item>'.repeat(50_000)}</channel></rss>`;
      expect(ok.length).toBeGreaterThan(512 * 1024);
      expect(ok.length).toBeLessThan(4 * 1024 * 1024);
      serve({ [SELF_HOSTED]: () => textResponse(ok, { chunkSize: 64 * 1024 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(ok);
    });
  });

  describe('header hygiene', () => {
    it('forwards none of the client request headers upstream', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes(
        'GET',
        { url: SELF_HOSTED },
        {
          cookie: 'session=secret',
          authorization: 'Bearer secret',
          'x-forwarded-host': 'evil.example.com'
        }
      );
      await handler(req, res);

      expect(mockFetch.mock.calls[0][1].headers).toEqual({
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'MSP-FeedProxy/1.0'
      });
    });

    it('forces an XML content-type instead of echoing the upstream one', async () => {
      serve({
        [SELF_HOSTED]: () => textResponse(RSS, { headers: { 'content-type': 'text/html' } })
      });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(headerValue(res, 'Content-Type')).toBe('application/xml; charset=utf-8');
      expect(headerValue(res, 'X-Content-Type-Options')).toBe('nosniff');
    });

    it('does not hand out a wildcard CORS origin', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED }, { origin: 'https://evil.example.com' });
      await handler(req, res);

      expect(headerValue(res, 'Access-Control-Allow-Origin')).toBeUndefined();
    });

    it('allows the canonical MSP origin', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes(
        'GET',
        { url: SELF_HOSTED },
        { origin: 'https://musicsideproject.com' }
      );
      await handler(req, res);

      expect(headerValue(res, 'Access-Control-Allow-Origin')).toBe('https://musicsideproject.com');
    });
  });

  describe('error reporting', () => {
    it('reports a 404 as not-found', async () => {
      serve({ [SELF_HOSTED]: () => textResponse('', { status: 404 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'not-found' }));
    });

    it('reports a 403 as blocked, so the client can mention bot protection', async () => {
      serve({ [SELF_HOSTED]: () => textResponse('', { status: 403 }) });
      const { default: handler } = await import('./proxy-feed');
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'blocked' }));
    });
  });

  describe('rate limiting', () => {
    it('rate limits after 60 requests from one IP', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');

      for (let i = 0; i < 60; i++) {
        const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED }, { 'x-forwarded-for': '1.2.3.4' });
        await handler(req, res);
      }
      const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED }, { 'x-forwarded-for': '1.2.3.4' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });

    it('does not consume another endpoint\'s budget (the shared-Map footgun)', async () => {
      serve({ [SELF_HOSTED]: () => textResponse(RSS) });
      const { default: handler } = await import('./proxy-feed');
      for (let i = 0; i < 60; i++) {
        const { req, res } = createMockReqRes('GET', { url: SELF_HOSTED }, { 'x-forwarded-for': '5.6.7.8' });
        await handler(req, res);
      }

      const { checkRateLimit } = await import('./_utils/rateLimiter.js');
      expect(checkRateLimit('verify-feed-url:5.6.7.8', { limit: 30, windowMs: 3600_000 }).allowed).toBe(true);
    });
  });
});
