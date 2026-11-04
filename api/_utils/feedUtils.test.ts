import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  it('trims paste whitespace off the feed URL before sending', async () => {
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret-123';
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });

    const { notifyPodping } = await import('./feedUtils');
    await notifyPodping('  https://example.com/feed.xml\n');

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toContain('url=https%3A%2F%2Fexample.com%2Ffeed.xml');
    // A leading space would encode as %20 and reach Hive as a different feed.
    expect(calledUrl).not.toContain('%20');
    expect(calledUrl).not.toContain('%0A');
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

describe('schedulePodping', () => {
  const HOSTED_URL = 'https://musicsideproject.com/api/hosted/abc.xml';
  const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
  const globals = globalThis as Record<symbol, unknown>;
  const urlsFetched = () => mockFetch.mock.calls.map(([url]) => String(url));

  function onVercel() {
    const waitUntil = vi.fn();
    globals[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) };
    return waitUntil;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    process.env.PODPING_ENDPOINT_URL = 'https://hive.example.com/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;
    delete globals[REQUEST_CONTEXT];
    mockFetch.mockReset();
  });

  it('holds a hosted feed until the caches have caught up, then notifies PI and Hive', async () => {
    const waitUntil = onVercel();
    const { schedulePodping, HOSTED_FEED_SETTLE_MS } = await import('./feedUtils');

    schedulePodping(HOSTED_URL, { medium: 'music' });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOSTED_FEED_SETTLE_MS - 1);
    expect(mockFetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await waitUntil.mock.calls[0][0];

    expect(urlsFetched()).toHaveLength(2);
    expect(urlsFetched()[0]).toContain('hub/pubnotify');
    expect(urlsFetched()[1]).toContain('https://hive.example.com/');
    expect(urlsFetched()[1]).toContain('medium=music');
  });

  it('waits longer than the 60 s blob CDN floor plus the edge TTL', async () => {
    const { HOSTED_FEED_SETTLE_MS, HOSTED_FEED_EDGE_TTL_S } = await import('./feedUtils');

    expect(HOSTED_FEED_SETTLE_MS).toBeGreaterThan((60 + HOSTED_FEED_EDGE_TTL_S) * 1000);
  });

  it('still sends the podping when the delayed pubnotify fails', async () => {
    const waitUntil = onVercel();
    mockFetch.mockRejectedValueOnce(new Error('PI down'));
    const { schedulePodping, HOSTED_FEED_SETTLE_MS } = await import('./feedUtils');

    schedulePodping(HOSTED_URL);
    await vi.advanceTimersByTimeAsync(HOSTED_FEED_SETTLE_MS);
    await waitUntil.mock.calls[0][0];

    expect(urlsFetched()[1]).toContain('https://hive.example.com/');
  });

  it('sends a self-hosted feed at once, since MSP wrote nothing for it to wait on', async () => {
    const waitUntil = onVercel();
    const { schedulePodping } = await import('./feedUtils');

    schedulePodping('https://example.com/feed.xml', { medium: 'music' });

    expect(waitUntil).not.toHaveBeenCalled();
    expect(urlsFetched()).toHaveLength(1);
    expect(urlsFetched()[0]).toContain('https://hive.example.com/');
  });

  it('sends a hosted feed at once when nothing can keep the function alive for the wait', async () => {
    const { schedulePodping } = await import('./feedUtils');

    schedulePodping(HOSTED_URL);

    expect(urlsFetched()).toHaveLength(1);
    expect(urlsFetched()[0]).toContain('https://hive.example.com/');
  });

  it('holds nothing when podping is not configured', async () => {
    delete process.env.PODPING_ENDPOINT_URL;
    const waitUntil = onVercel();
    const { schedulePodping, HOSTED_FEED_SETTLE_MS } = await import('./feedUtils');

    schedulePodping(HOSTED_URL);
    await vi.advanceTimersByTimeAsync(HOSTED_FEED_SETTLE_MS);

    expect(waitUntil).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps a hosted save out of the podping wait: the response path only reaches PI', async () => {
    const waitUntil = onVercel();
    process.env.PODCASTINDEX_API_KEY = 'test-key';
    process.env.PODCASTINDEX_API_SECRET = 'test-secret';
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' })
      .mockResolvedValueOnce({ status: 200, text: async () => JSON.stringify({ status: true, feed: { id: 7 } }) });
    const { notifyPodcastIndex } = await import('./feedUtils');

    const result = await notifyPodcastIndex(HOSTED_URL, { medium: 'music' });

    expect(result).toEqual({ podcastIndexId: 7 });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(urlsFetched()).toHaveLength(2);
    expect(urlsFetched()[0]).toContain('hub/pubnotify');
    expect(urlsFetched()[1]).toContain('add/byfeedurl');
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
