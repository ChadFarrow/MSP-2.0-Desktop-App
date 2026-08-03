import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('notifyPodping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;
  });

  it('no-ops and returns { ok: false } when PODPING_ENDPOINT_URL is unset', async () => {
    process.env.PODPING_BEARER_TOKEN = 'secret';
    const { notifyPodping } = await import('./feedUtils');

    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/endpoint|url/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('no-ops and returns { ok: false } when PODPING_BEARER_TOKEN is unset', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    const { notifyPodping } = await import('./feedUtils');

    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/token|bearer/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends request with Bearer header and query params on success', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml', {
      reason: 'update',
      medium: 'music'
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('https://podping.example/?');
    expect(calledUrl).toContain('url=https%3A%2F%2Fexample.com%2Ffeed.xml');
    expect(calledUrl).toContain('reason=update');
    expect(calledUrl).toContain('medium=music');
    expect(calledInit.method).toBe('GET');
    expect(calledInit.headers.Authorization).toBe('Bearer secret-123');
  });

  it('omits reason and medium params when not provided', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { notifyPodping } = await import('./feedUtils');
    await notifyPodping('https://example.com/feed.xml');

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).not.toContain('reason=');
    expect(calledUrl).not.toContain('medium=');
  });

  it('returns { ok: false, status } on upstream 5xx', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'upstream error'
    });

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBeDefined();
  });

  it('returns { ok: false, error } on network failure', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { notifyPodping } = await import('./feedUtils');
    const result = await notifyPodping('https://example.com/feed.xml');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});

describe('notifyPodcastIndex', () => {
  // fetch #1 is the pubnotify ping (fire-and-forget, response ignored);
  // fetch #2 is add/byfeedurl, whose outcome is what we assert on.
  const PUBNOTIFY_OK = { ok: true, status: 200, text: async () => '' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Keep podping out of the fetch sequence so call #2 is always add/byfeedurl.
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;
    process.env.PODCASTINDEX_API_KEY = 'test-key';
    process.env.PODCASTINDEX_API_SECRET = 'test-secret';
  });

  it('returns the feed id and no addResult when PI registers the feed', async () => {
    mockFetch
      .mockResolvedValueOnce(PUBNOTIFY_OK)
      .mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify({ status: true, feed: { id: 6590182 } }) });

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result).toEqual({ podcastIndexId: 6590182 });
    expect(mockFetch.mock.calls[1][0]).toContain('add/byfeedurl');
  });

  it("surfaces PI's rejection reason when no feed id comes back", async () => {
    mockFetch
      .mockResolvedValueOnce(PUBNOTIFY_OK)
      .mockResolvedValueOnce({
        status: 400,
        text: async () => JSON.stringify({ status: 'false', description: 'Feed is not a podcast feed' })
      });

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result.podcastIndexId).toBeNull();
    expect(result.addResult).toEqual({
      httpStatus: 400,
      status: 'false',
      description: 'Feed is not a podcast feed'
    });
  });

  it('reports a non-JSON body as the reason', async () => {
    mockFetch
      .mockResolvedValueOnce(PUBNOTIFY_OK)
      .mockResolvedValueOnce({ status: 502, text: async () => '<html>Bad Gateway</html>' });

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result.podcastIndexId).toBeNull();
    expect(result.addResult?.httpStatus).toBe(502);
    expect(result.addResult?.description).toContain('non-JSON');
  });

  it('reports an empty body as the reason', async () => {
    mockFetch
      .mockResolvedValueOnce(PUBNOTIFY_OK)
      .mockResolvedValueOnce({ status: 204, text: async () => '' });

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result.podcastIndexId).toBeNull();
    expect(result.addResult).toEqual({ httpStatus: 204, description: 'empty response body' });
  });

  it('reports a network failure as the reason', async () => {
    mockFetch
      .mockResolvedValueOnce(PUBNOTIFY_OK)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result).toEqual({ podcastIndexId: null, addResult: { error: 'ECONNREFUSED' } });
  });

  it('skips add/byfeedurl and explains why when PI credentials are unset', async () => {
    delete process.env.PODCASTINDEX_API_KEY;
    delete process.env.PODCASTINDEX_API_SECRET;
    mockFetch.mockResolvedValueOnce(PUBNOTIFY_OK);

    const { notifyPodcastIndex } = await import('./feedUtils');
    const result = await notifyPodcastIndex('https://example.com/feed.xml');

    expect(result.podcastIndexId).toBeNull();
    expect(result.addResult?.description).toMatch(/credentials/i);
    // Only the pubnotify ping went out — no add attempt.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings', async () => {
    const { timingSafeEqualHex, hashToken } = await import('./feedUtils');
    const h = hashToken('some-secret-token');
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });

  it('returns false for differing hex strings of equal length', async () => {
    const { timingSafeEqualHex, hashToken } = await import('./feedUtils');
    expect(timingSafeEqualHex(hashToken('a'), hashToken('b'))).toBe(false);
  });

  it('returns false for length mismatch without throwing', async () => {
    const { timingSafeEqualHex } = await import('./feedUtils');
    expect(timingSafeEqualHex('abcd', 'abcdef')).toBe(false);
  });

  it('returns false for non-string input', async () => {
    const { timingSafeEqualHex } = await import('./feedUtils');
    // @ts-expect-error testing defensive runtime guard
    expect(timingSafeEqualHex(undefined, 'abcd')).toBe(false);
  });
});
