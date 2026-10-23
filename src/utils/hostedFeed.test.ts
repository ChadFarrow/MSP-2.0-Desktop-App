import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildHostedUrl, createHostedFeed, updateHostedFeed } from './hostedFeed';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('hosted feed request errors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries the HTTP status of a refused create, with the server message', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(
      { error: 'Feed already exists for this podcast. Use your edit token to update it, or use the Restore flow.' },
      409
    ));
    await expect(createHostedFeed('<rss/>', 'Title', 'guid')).rejects.toMatchObject({
      status: 409,
      message: 'Feed already exists for this podcast. Use your edit token to update it, or use the Restore flow.'
    });
  });

  it('carries the status when the body is not JSON, falling back to the generic message', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => { throw new Error('not json'); } });
    await expect(updateHostedFeed('id', 'token', '<rss/>', 'Title')).rejects.toMatchObject({
      status: 403,
      message: 'Failed to update feed'
    });
  });
});

describe('buildHostedUrl', () => {
  // The URL ends up inside published feeds (a catalog's remoteItem, the URL sent
  // to Podcast Index), so it never depends on the page it was made on.
  afterEach(() => vi.unstubAllEnvs());

  it('uses the canonical domain when VITE_CANONICAL_URL is unset', () => {
    vi.stubEnv('VITE_CANONICAL_URL', '');
    expect(buildHostedUrl('abc')).toBe('https://musicsideproject.com/api/hosted/abc.xml');
  });

  it('takes VITE_CANONICAL_URL without its trailing slash', () => {
    vi.stubEnv('VITE_CANONICAL_URL', 'https://example.org/');
    expect(buildHostedUrl('abc')).toBe('https://example.org/api/hosted/abc.xml');
  });
});
