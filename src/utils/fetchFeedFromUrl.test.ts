import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFeedFromUrl, FeedFetchError } from './xmlParser';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const RSS = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';
const SELF_HOSTED = 'https://headstarts.uk/msp/albums/please-stand-by.xml';
const MSP_HOSTED = 'https://musicsideproject.com/api/hosted/abc123.xml';

function ok(body: string) {
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
}

function errorJson(status: number, payload: Record<string, unknown>) {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}

const proxyCall = () => mockFetch.mock.calls.find((c) => String(c[0]).startsWith('/api/proxy-feed'));

describe('fetchFeedFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never sends a feed URL to a third-party CORS proxy', async () => {
    // The invariant that has to survive future refactors. allorigins.win and
    // corsproxy.io used to sit in the fallback chain, leaking every user's feed
    // URL to a third party.
    mockFetch.mockResolvedValue(ok(RSS));
    await fetchFeedFromUrl(SELF_HOSTED);

    for (const [url] of mockFetch.mock.calls) {
      expect(String(url)).not.toContain('allorigins');
      expect(String(url)).not.toContain('corsproxy');
      expect(
        String(url) === SELF_HOSTED || String(url).startsWith('/api/proxy-feed')
      ).toBe(true);
    }
  });

  it('returns a direct fetch without touching the proxy', async () => {
    mockFetch.mockResolvedValueOnce(ok(RSS));
    await expect(fetchFeedFromUrl(SELF_HOSTED)).resolves.toBe(RSS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(proxyCall()).toBeUndefined();
  });

  it('falls back to the proxy when a direct fetch is CORS-blocked', async () => {
    // A CORS rejection surfaces as a bare TypeError and says nothing about the
    // feed, so it must never be the error the user sees.
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(ok(RSS));

    await expect(fetchFeedFromUrl(SELF_HOSTED)).resolves.toBe(RSS);
    expect(proxyCall()).toBeDefined();
  });

  it('falls through to the proxy when a direct fetch returns an HTML 200', async () => {
    mockFetch.mockResolvedValueOnce(ok('<!doctype html><html>not a feed</html>'));
    mockFetch.mockResolvedValueOnce(ok(RSS));
    await expect(fetchFeedFromUrl(SELF_HOSTED)).resolves.toBe(RSS);
  });

  it('goes straight to the proxy for an MSP-hosted URL', async () => {
    mockFetch.mockResolvedValueOnce(ok(RSS));
    await expect(fetchFeedFromUrl(MSP_HOSTED)).resolves.toBe(RSS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(proxyCall()).toBeDefined();
  });

  it('reports a 404 as a missing feed rather than a generic failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(errorJson(404, { error: 'x', code: 'not-found' }));

    await expect(fetchFeedFromUrl(SELF_HOSTED)).rejects.toThrow(/404 Not Found/);
  });

  it('explains a blocked feed as bot protection', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(errorJson(403, { error: 'x', code: 'blocked' }));

    await expect(fetchFeedFromUrl(SELF_HOSTED)).rejects.toThrow(/Bot protection/);
  });

  it('carries the code and status on the error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(errorJson(415, { error: 'x', code: 'not-a-feed' }));

    const err = await fetchFeedFromUrl(SELF_HOSTED).catch((e) => e);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect(err.code).toBe('not-a-feed');
    expect(err.status).toBe(415);
  });

  it("falls back to the server's own message for a code it doesn't know", async () => {
    // So adding a code server-side degrades to a usable message, not a wrong one.
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(
      errorJson(400, { error: 'Something specific happened', code: 'brand-new-code' })
    );

    await expect(fetchFeedFromUrl(SELF_HOSTED)).rejects.toThrow(/Something specific happened/);
  });

  it('reports our own proxy being unreachable as such', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchFeedFromUrl(SELF_HOSTED)).rejects.toThrow(/Could not reach MSP/);
  });

  it('still offers pasting the XML as a way out', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockFetch.mockResolvedValueOnce(errorJson(404, { error: 'x', code: 'not-found' }));

    await expect(fetchFeedFromUrl(SELF_HOSTED)).rejects.toThrow(/paste the XML content directly/);
  });
});
