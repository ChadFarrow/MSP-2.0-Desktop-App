import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

import { guardFeedSubmission, isMspHostedUrl, wantsForce } from './feedReachability.js';
import { __resetRateLimiterForTests } from './rateLimiter.js';

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const FEED_URL = 'https://rollzmcguyver.com/Rollz_McGuyver.xml';
const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

function textResponse(body: string, init: { status?: number } = {}) {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })),
        cancel: async () => {}
      })
    },
    text: async () => body
  };
}

/** Both probes answer with a freshly built response. */
function serveAll(make: () => unknown) {
  mockFetch.mockImplementation(async () => make());
}

describe('isMspHostedUrl', () => {
  it('matches the canonical and legacy hosts', () => {
    expect(isMspHostedUrl('https://musicsideproject.com/api/hosted/abc.xml')).toBe(true);
    expect(isMspHostedUrl('https://msp.podtards.com/api/hosted/abc.xml')).toBe(true);
    expect(isMspHostedUrl('https://new.musicsideproject.com/api/hosted/abc.xml')).toBe(true);
  });

  it('matches a hosted path on any origin, so preview deploys are skipped too', () => {
    expect(isMspHostedUrl('https://msp-2-0-git-branch.vercel.app/api/hosted/abc.xml')).toBe(true);
  });

  it('does not match a lookalike domain', () => {
    expect(isMspHostedUrl('https://notmusicsideproject.com/feed.xml')).toBe(false);
  });

  it('does not match an unrelated self-hosted feed', () => {
    expect(isMspHostedUrl(FEED_URL)).toBe(false);
  });

  it('returns false for an unparseable URL rather than throwing', () => {
    expect(isMspHostedUrl('not a url')).toBe(false);
  });
});

describe('wantsForce', () => {
  it('accepts the shapes a query param and a JSON body arrive in', () => {
    expect(wantsForce(true)).toBe(true);
    expect(wantsForce('1')).toBe(true);
    expect(wantsForce('true')).toBe(true);
  });

  it('rejects everything else', () => {
    for (const value of [false, '0', 'false', '', undefined, null, 1, {}]) {
      expect(wantsForce(value)).toBe(false);
    }
  });
});

describe('guardFeedSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockLookup.mockResolvedValue(PUBLIC_V4);
    __resetRateLimiterForTests();
  });

  it('refuses a feed whose host blocks our crawler, and explains how to fix it', async () => {
    serveAll(() => textResponse('denied', { status: 403 }));

    const refusal = await guardFeedSubmission(FEED_URL);

    expect(refusal).not.toBeNull();
    expect(refusal!.reachability).toEqual({ ok: false, status: 403, looksLikeFeed: false, reason: 'blocked' });
    expect(refusal!.error).toContain('403');
    expect(refusal!.error).toMatch(/bot protection/i);
  });

  it('refuses on a 401 and a 429 too', async () => {
    for (const status of [401, 429]) {
      mockFetch.mockReset();
      serveAll(() => textResponse('denied', { status }));
      const refusal = await guardFeedSubmission(FEED_URL);
      expect(refusal?.reachability.status).toBe(status);
    }
  });

  it('allows a feed that is reachable', async () => {
    serveAll(() => textResponse(RSS));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open on a 404 — a wrong URL is the user’s to fix, not ours to block', async () => {
    serveAll(() => textResponse('Not Found', { status: 404 }));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open on a server error', async () => {
    serveAll(() => textResponse('boom', { status: 503 }));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open on a timeout', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open when the host does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open when the URL serves a web page instead of RSS', async () => {
    serveAll(() => textResponse('<!doctype html><html><body>hi</body></html>'));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('fails open when the URL redirects somewhere unsafe, without calling it a host block', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      status: 302,
      headers: { get: (n: string) => (n.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null) },
      body: null,
      text: async () => ''
    }));
    expect(await guardFeedSubmission(FEED_URL)).toBeNull();
  });

  it('skips the probe entirely for MSP-hosted feeds', async () => {
    const refusal = await guardFeedSubmission('https://musicsideproject.com/api/hosted/abc.xml');
    expect(refusal).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips the probe when the caller forces the submit', async () => {
    serveAll(() => textResponse('denied', { status: 403 }));
    const refusal = await guardFeedSubmission(FEED_URL, { force: true });
    expect(refusal).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails open once an IP exhausts its probe budget', async () => {
    serveAll(() => textResponse('denied', { status: 403 }));

    for (let i = 0; i < 60; i++) {
      expect(await guardFeedSubmission(FEED_URL, { clientIp: '1.2.3.4' })).not.toBeNull();
    }

    // Over budget: the probe is skipped, so the submit proceeds rather than being
    // blocked by our own rate limiter.
    const overBudget = await guardFeedSubmission(FEED_URL, { clientIp: '1.2.3.4' });
    expect(overBudget).toBeNull();

    // A different caller is unaffected.
    expect(await guardFeedSubmission(FEED_URL, { clientIp: '5.6.7.8' })).not.toBeNull();
  });

  it('never puts response content in the refusal', async () => {
    mockFetch.mockImplementation(async () => textResponse('INTERNAL SECRET', { status: 403 }));
    const refusal = await guardFeedSubmission(FEED_URL);
    expect(JSON.stringify(refusal)).not.toContain('INTERNAL SECRET');
  });
});
