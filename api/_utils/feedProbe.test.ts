import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

import { probeFeedUrl, classifyStatus } from './feedProbe.js';

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const FEED_URL = 'https://example.com/feed.xml';
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

/**
 * Two probes hit the same URL, so stubs must be per-URL *factories*, not a queue
 * and not a shared object — a Response-alike's reader is single-use, so reusing
 * one instance hands the second probe an empty body.
 */
function serve(map: Record<string, () => unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    const make = map[url];
    if (!make) throw new Error(`unexpected fetch: ${url}`);
    return make();
  });
}

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

/** Headers of the call that carried a Range header, i.e. the ranged probe. */
function rangedCall() {
  return mockFetch.mock.calls.find((c) => c[1]?.headers?.Range);
}

describe('classifyStatus', () => {
  it('treats auth and throttling responses as a block', () => {
    expect(classifyStatus(401)).toBe('blocked');
    expect(classifyStatus(403)).toBe('blocked');
    expect(classifyStatus(429)).toBe('blocked');
  });

  it('treats missing resources as not-found', () => {
    expect(classifyStatus(404)).toBe('not-found');
    expect(classifyStatus(410)).toBe('not-found');
  });

  it('treats everything else as a server error', () => {
    expect(classifyStatus(500)).toBe('server-error');
    expect(classifyStatus(503)).toBe('server-error');
    expect(classifyStatus(418)).toBe('server-error');
  });
});

describe('probeFeedUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue(PUBLIC_V4);
  });

  it('issues exactly two probes — one bare, one ranged', async () => {
    serve({ [FEED_URL]: () => textResponse(RSS) });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(rangedCall()?.[1].headers.Range).toBe('bytes=0-2047');
    // The other probe is deliberately a different request shape — bot protection
    // scores request shape, so two identical probes would be one sample.
    const bare = mockFetch.mock.calls.find((c) => !c[1]?.headers?.Range);
    expect(bare?.[1].headers.Range).toBeUndefined();
    expect(bare?.[1].headers['User-Agent']).toBe('MSP-FeedVerifier/1.0');
  });

  it('lets a block on the ranged probe win over a success on the bare one', async () => {
    let call = 0;
    mockFetch.mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      call += 1;
      return init.headers?.Range ? textResponse('denied', { status: 403 }) : textResponse(RSS);
    });

    const result = await probeFeedUrl(FEED_URL);

    expect(call).toBe(2);
    expect(result.verdict).toBe('blocked');
    expect(result.outcome).toMatchObject({ reachable: false, status: 403 });
  });

  it('lets a block on the bare probe win over a success on the ranged one', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) =>
      init.headers?.Range ? textResponse(RSS, { status: 206 }) : textResponse('denied', { status: 403 })
    );

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('blocked');
    expect(result.outcome.status).toBe(403);
  });

  it('accepts a 206 from the ranged probe as reachable', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) =>
      init.headers?.Range ? textResponse(RSS, { status: 206 }) : textResponse('nope', { status: 405 })
    );

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('ok');
    expect(result.outcome).toMatchObject({ reachable: true, status: 206, looksLikeFeed: true });
  });

  it('reports looksLikeFeed when either probe saw a feed marker', async () => {
    // The bare probe succeeds first (so its outcome is the base) but its 2 KB-truncated
    // sibling is the one that saw the marker.
    mockFetch.mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) =>
      init.headers?.Range ? textResponse(RSS, { status: 206 }) : textResponse('x'.repeat(50))
    );

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('ok');
    expect(result.outcome.status).toBe(200); // bare probe's outcome is the base
    expect(result.outcome.looksLikeFeed).toBe(true);
  });

  it('reports a 404 as not-found without a reason string', async () => {
    serve({ [FEED_URL]: () => textResponse('Not Found', { status: 404 }) });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('not-found');
    expect(result.outcome).toEqual({ reachable: false, status: 404, finalUrl: FEED_URL });
  });

  it('reports an HTML page as reachable but not feed-shaped', async () => {
    serve({ [FEED_URL]: () => textResponse('<!doctype html><html><body>hi</body></html>') });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('ok');
    expect(result.outcome).toMatchObject({ reachable: true, looksLikeFeed: false });
  });

  it('re-checks safety on every redirect hop and never fetches the blocked target', async () => {
    serve({ [FEED_URL]: () => redirectResponse(302, 'http://169.254.169.254/latest/meta-data/') });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('unsafe');
    expect(result.outcome.reason).toContain('Redirected to a blocked address');
    // The invariant that matters: nothing but the original URL was ever fetched.
    expect(mockFetch.mock.calls.every((c) => c[0] === FEED_URL)).toBe(true);
  });

  it('follows a safe redirect in both walks and reports the final URL', async () => {
    const moved = 'https://example.com/new-feed.xml';
    serve({
      [FEED_URL]: () => redirectResponse(301, moved),
      [moved]: () => textResponse(RSS)
    });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('ok');
    expect(result.outcome.finalUrl).toBe(moved);
    expect(mockFetch).toHaveBeenCalledTimes(4); // two hops × two probes
  });

  it('gives up after too many redirects', async () => {
    mockFetch.mockImplementation(async () => redirectResponse(302, 'https://example.com/feed.xml?x=1'));

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('server-error');
    expect(result.outcome.reason).toBe('Too many redirects');
  });

  it('refuses a private first hop without fetching anything', async () => {
    const result = await probeFeedUrl('http://127.0.0.1/feed.xml');

    expect(result.refuseWithStatus).toBe(403);
    expect(result.verdict).toBe('unsafe');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses a public hostname that resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    const result = await probeFeedUrl(FEED_URL);

    expect(result.refuseWithStatus).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports an unresolvable host as dns, not a refusal', async () => {
    mockLookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));

    const result = await probeFeedUrl('https://nope.invalid/feed.xml');

    expect(result.verdict).toBe('dns');
    expect(result.refuseWithStatus).toBeUndefined();
    expect(result.outcome).toEqual({ reachable: false, reason: 'Could not resolve host' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports a timeout when both probes abort, naming the caller’s budget', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const result = await probeFeedUrl(FEED_URL, { timeoutMs: 4000 });

    expect(result.verdict).toBe('timeout');
    expect(result.outcome.reason).toBe('Timed out after 4 seconds');
  });

  it('reports a connection failure rather than throwing', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('network');
    expect(result.outcome.reason).toBe('Could not connect to that address');
  });

  it('uses one probe’s verdict when the other throws', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { headers?: Record<string, string> }) => {
      if (init.headers?.Range) throw new Error('ECONNRESET');
      return textResponse('boom', { status: 503 });
    });

    const result = await probeFeedUrl(FEED_URL);

    expect(result.verdict).toBe('server-error');
    expect(result.outcome.status).toBe(503);
  });

  it('never puts response content in the outcome', async () => {
    const secret = '<rss><channel><title>super-secret-internal-value</title></channel></rss>';
    serve({ [FEED_URL]: () => textResponse(secret) });

    const result = await probeFeedUrl(FEED_URL);

    // Precondition: the probe actually succeeded, so this is a real assertion and
    // not a fetch failure quietly producing a body-free result.
    expect(result.outcome.reachable).toBe(true);
    expect(JSON.stringify(result)).not.toContain('super-secret-internal-value');
  });
});
