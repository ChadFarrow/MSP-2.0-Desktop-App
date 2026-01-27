import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Mock fetch globally before importing the handler
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto for auth header generation
vi.mock('crypto', () => ({
  default: {
    createHash: () => ({
      update: () => ({
        digest: () => 'mock-hash'
      })
    })
  }
}));

// Helper to create mock request/response
function createMockReqRes(query: Record<string, string | undefined>) {
  const req = {
    method: 'GET',
    query
  } as VercelRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;

  return { req, res };
}

describe('pubnotify API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Set env vars before each test
    process.env.PODCASTINDEX_API_KEY = 'test-api-key';
    process.env.PODCASTINDEX_API_SECRET = 'test-api-secret';
  });

  it('returns 405 for non-GET requests', async () => {
    const { default: handler } = await import('./pubnotify');
    const { req, res } = createMockReqRes({ url: 'https://example.com/feed.xml' });
    req.method = 'POST';

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });

  it('returns 400 if url parameter is missing', async () => {
    const { default: handler } = await import('./pubnotify');
    const { req, res } = createMockReqRes({});

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing url parameter' });
  });

  it('returns 400 for invalid URL format', async () => {
    const { default: handler } = await import('./pubnotify');
    const { req, res } = createMockReqRes({ url: 'not-a-valid-url' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid URL format' });
  });

  it('calls pubnotify and returns success without lookup when no auth', async () => {
    // Remove API credentials
    delete process.env.PODCASTINDEX_API_KEY;
    delete process.env.PODCASTINDEX_API_SECRET;

    const { default: handler } = await import('./pubnotify');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    const { req, res } = createMockReqRes({ url: 'https://example.com/feed.xml' });

    await handler(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('hub/pubnotify');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      podcastIndexId: null,
      podcastIndexUrl: null
    }));
  });

  it('tries GUID lookup first when guid parameter is provided', async () => {
    const { default: handler } = await import('./pubnotify');

    // Mock pubnotify success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    // Mock GUID lookup success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: { id: 12345 } })
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/feed.xml',
      guid: 'test-guid-123'
    });

    await handler(req, res);

    // Should have called pubnotify first, then byguid lookup
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('hub/pubnotify');
    expect(mockFetch.mock.calls[1][0]).toContain('podcasts/byguid');
    expect(mockFetch.mock.calls[1][0]).toContain('guid=test-guid-123');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      podcastIndexId: 12345,
      podcastIndexUrl: 'https://podcastindex.org/podcast/12345'
    }));
  });

  it('falls back to URL lookup when GUID lookup fails', async () => {
    const { default: handler } = await import('./pubnotify');

    // Mock pubnotify success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    // Mock GUID lookup failure (not found)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: null })
    });

    // Mock URL lookup success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: { id: 67890 } })
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/feed.xml',
      guid: 'unknown-guid'
    });

    await handler(req, res);

    // Should have called pubnotify, then byguid, then byfeedurl
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toContain('hub/pubnotify');
    expect(mockFetch.mock.calls[1][0]).toContain('podcasts/byguid');
    expect(mockFetch.mock.calls[2][0]).toContain('podcasts/byfeedurl');

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      podcastIndexId: 67890,
      podcastIndexUrl: 'https://podcastindex.org/podcast/67890'
    }));
  });

  it('only uses URL lookup when no GUID is provided', async () => {
    const { default: handler } = await import('./pubnotify');

    // Mock pubnotify success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    // Mock URL lookup success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: { id: 11111 } })
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/feed.xml'
      // No guid parameter
    });

    await handler(req, res);

    // Should have called pubnotify, then byfeedurl (skipping byguid)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('hub/pubnotify');
    expect(mockFetch.mock.calls[1][0]).toContain('podcasts/byfeedurl');
    // Should NOT have called byguid
    expect(mockFetch.mock.calls[1][0]).not.toContain('byguid');

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      podcastIndexId: 11111,
      podcastIndexUrl: 'https://podcastindex.org/podcast/11111'
    }));
  });

  it('returns success without podcastIndexUrl when feed is not yet indexed', async () => {
    const { default: handler } = await import('./pubnotify');

    // Mock pubnotify success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    // Mock lookup failure (not found)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: null })
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/new-feed.xml'
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      podcastIndexId: null,
      podcastIndexUrl: null
    }));
  });

  it('returns error when pubnotify fails', async () => {
    const { default: handler } = await import('./pubnotify');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue(JSON.stringify({ description: 'Server error' }))
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/feed.xml'
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Server error'
    }));
  });

  it('returns direct podcast URL format', async () => {
    const { default: handler } = await import('./pubnotify');

    // Mock pubnotify success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true }))
    });

    // Mock GUID lookup returns specific ID
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ feed: { id: 7642183 } })
    });

    const { req, res } = createMockReqRes({
      url: 'https://example.com/feed.xml',
      guid: 'some-guid'
    });

    await handler(req, res);

    // Verify the URL format is correct (direct link, not search)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      podcastIndexUrl: 'https://podcastindex.org/podcast/7642183'
    }));

    // Ensure it's NOT a search URL
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.podcastIndexUrl).not.toContain('search?q=');
  });
});
