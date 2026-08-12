import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Neutralize the reachability guard — see the note in pubnotify.test.ts.
const { mockGuard } = vi.hoisted(() => ({ mockGuard: vi.fn() }));
vi.mock('./_utils/feedReachability.js', () => ({
  guardFeedSubmission: mockGuard,
  wantsForce: (v: unknown) => v === true || v === '1' || v === 'true'
}));

function createMockReqRes(method: string, body: Record<string, unknown>) {
  const req = { method, body, headers: {} } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as any;
  return { req, res };
}

describe('/api/pisubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGuard.mockResolvedValue(null);
    process.env.PODCASTINDEX_API_KEY = 'test-api-key';
    process.env.PODCASTINDEX_API_SECRET = 'test-api-secret';
  });

  it('rejects non-POST methods', async () => {
    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('GET', { url: 'https://example.com/feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when url is missing', async () => {
    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a URL containing interior whitespace', async () => {
    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', { url: 'https://example.com/my feed.xml' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('submits a reachable feed and returns its Podcast Index id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: true, description: 'Feed added', feedId: 7642183 })
    });

    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', { url: 'https://example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, feedId: 7642183 });
  });

  it('refuses a feed whose host blocks crawlers', async () => {
    mockGuard.mockResolvedValue({
      error: "This feed can't be reached — your host returned 403 to our crawler.",
      reachability: { ok: false, status: 403, looksLikeFeed: false, reason: 'blocked' }
    });

    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', { url: 'https://blocked.example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].reachability).toMatchObject({ reason: 'blocked' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes force through so "Submit anyway" can get past the guard', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: true }) });

    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', { url: 'https://blocked.example.com/feed.xml', force: true });
    await handler(req, res);

    expect(mockGuard).toHaveBeenCalledWith(
      'https://blocked.example.com/feed.xml',
      expect.objectContaining({ force: true })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // The refusal tells the user something they can act on; a missing API key is
  // our problem and would be a confusing thing to show them instead.
  it('reports a refusal ahead of missing credentials', async () => {
    delete process.env.PODCASTINDEX_API_KEY;
    delete process.env.PODCASTINDEX_API_SECRET;
    mockGuard.mockResolvedValue({
      error: 'blocked',
      reachability: { ok: false, status: 403, looksLikeFeed: false, reason: 'blocked' }
    });

    const { default: handler } = await import('./pisubmit');
    const { req, res } = createMockReqRes('POST', { url: 'https://blocked.example.com/feed.xml' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
