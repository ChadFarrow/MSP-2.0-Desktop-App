import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyFeedUrl, isGuardRefusal } from './verifyFeedUrl';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('verifyFeedUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a reachable, feed-shaped URL', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: true, looksLikeFeed: true }));
    expect(await verifyFeedUrl('https://example.com/feed.xml')).toEqual({ ok: true, warning: null });
  });

  it('encodes the URL into the query string', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: true, looksLikeFeed: true }));
    await verifyFeedUrl('https://example.com/feed.xml');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/verify-feed-url?url=https%3A%2F%2Fexample.com%2Ffeed.xml'
    );
  });

  it('names the 404 when the host does not have the file', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: false, status: 404 }));
    const result = await verifyFeedUrl('https://example.com/typo.xml');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/404/);
  });

  it('explains a 401 as a login wall rather than a missing file', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: false, status: 401 }));
    const result = await verifyFeedUrl('https://example.com/private.xml');
    expect(result.warning).toMatch(/login/i);
  });

  it('reports a 5xx as a host-side error', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: false, status: 503 }));
    expect((await verifyFeedUrl('https://example.com/feed.xml')).warning).toMatch(/503/);
  });

  it('falls back to the endpoint reason when there is no status', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ reachable: false, reason: 'Timed out after 10 seconds' })
    );
    const result = await verifyFeedUrl('https://slow.example.com/feed.xml');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/timed out after 10 seconds/i);
  });

  it('warns when the URL loads but is not a feed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ reachable: true, looksLikeFeed: false }));
    const result = await verifyFeedUrl('https://example.com/index.html');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/doesn't look like an RSS feed/i);
  });

  it('treats a 403 from MSP as a verdict about the address', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Address not allowed' }, 403));
    const result = await verifyFeedUrl('http://127.0.0.1/feed.xml');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/public URL/i);
  });

  // Our own outage must never be reported as the user's URL being broken, and
  // must never block a submission.
  it('passes when the verifier itself is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await verifyFeedUrl('https://example.com/feed.xml')).toEqual({ ok: true, warning: null });
  });

  it('passes when the verifier rate-limits or errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Too many' }, 429));
    expect((await verifyFeedUrl('https://example.com/feed.xml')).ok).toBe(true);

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
    expect((await verifyFeedUrl('https://example.com/feed.xml')).ok).toBe(true);
  });

  it('passes when the verifier returns unparseable JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      }
    });
    expect((await verifyFeedUrl('https://example.com/feed.xml')).ok).toBe(true);
  });
});

describe('isGuardRefusal', () => {
  it('recognises the shape the submit guard refuses with', () => {
    expect(
      isGuardRefusal({
        error: "This feed can't be reached — your host returned 403 to our crawler.",
        reachability: { ok: false, status: 403, looksLikeFeed: false, reason: 'blocked' }
      })
    ).toBe(true);
  });

  it('rejects an ordinary error body so normal error handling still runs', () => {
    expect(isGuardRefusal({ error: 'Invalid URL format' })).toBe(false);
    expect(isGuardRefusal(undefined)).toBe(false);
    expect(isGuardRefusal('blocked')).toBe(false);
  });

  it('rejects a reachability verdict that is not a block', () => {
    expect(
      isGuardRefusal({
        error: 'something else',
        reachability: { ok: false, status: 404, looksLikeFeed: false, reason: 'not-found' }
      })
    ).toBe(false);
  });
});
