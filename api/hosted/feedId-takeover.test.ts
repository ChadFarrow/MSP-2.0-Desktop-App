/**
 * A hosted feed whose .meta.json is missing has no stored credential, so there is
 * nothing to check a caller against. Every path that treats that state as "no owner,
 * so the caller may become the owner" is an unauthenticated takeover: feedId is the
 * podcastGuid, published in the feed's own <podcast:guid> and in the feed URL
 * registered with Podcast Index, so an attacker never has to guess it.
 *
 * These tests pin the refusals. Each one fails against the previous behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockList = vi.fn();
const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock('@vercel/blob', () => ({ list: mockList, put: mockPut, del: mockDel }));

vi.mock('../_utils/accountStore.js', () => ({
  addFeedToAccount: vi.fn(async () => {}),
  removeFeedFromAccount: vi.fn(async () => {})
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { hashToken } from '../_utils/feedUtils';

const FEED = '11111111-2222-3333-4444-555555555555';
const REAL_TOKEN = 'the-real-edit-token-aaaaaaaaaaaaaaaa';
const ATTACKER_TOKEN = 'attacker-picked-this-token-zzzzzzzz';

/** hasMeta=false models the orphaned-XML state; the .xml blob is always present. */
function configureBlobs(hasMeta: boolean) {
  const metaObj = hasMeta
    ? { editTokenHash: hashToken(REAL_TOKEN), createdAt: '1', title: 'My Feed' }
    : null;
  mockList.mockImplementation(({ prefix }: { prefix: string }) => {
    if (prefix === `feeds/${FEED}.meta.json`) {
      return Promise.resolve({
        blobs: metaObj ? [{ pathname: `feeds/${FEED}.meta.json`, url: 'https://blob/meta' }] : []
      });
    }
    if (prefix === `feeds/${FEED}.xml`) {
      return Promise.resolve({ blobs: [{ pathname: `feeds/${FEED}.xml`, url: 'https://blob/xml' }] });
    }
    return Promise.resolve({ blobs: [] });
  });
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).includes('meta')
        ? { text: async () => (metaObj ? JSON.stringify(metaObj) : ''), json: async () => metaObj ?? {} }
        : { text: async () => '<rss>feed</rss>' }
    )
  );
}

function reqRes(method: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const req = {
    method,
    query: { feedId: FEED },
    headers: opts.headers ?? {},
    body: opts.body
  } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;
  return { req, res };
}

describe('hosted feed takeover via a missing metadata blob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPut.mockResolvedValue({});
    mockDel.mockResolvedValue({});
  });

  it('PUT with an attacker-chosen token does not adopt an unowned feed', async () => {
    // Previously: `if (!metadata)` accepted any token and set
    // storedHash = hashToken(editToken), making the caller the owner — and the new
    // XML (with the attacker's <podcast:value> splits) was written.
    configureBlobs(false);
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-edit-token': ATTACKER_TOKEN },
      body: { xml: '<rss>attacker payload</rss>' }
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('DELETE with any non-empty token does not delete an unowned feed', async () => {
    // Previously: `metadata ? isAuthorizedFeedWrite(...) : hasTokenHeader`, where
    // hasTokenHeader was merely "a non-empty string" — so `X-Edit-Token: x` deleted it.
    configureBlobs(false);
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('DELETE', { headers: { 'x-edit-token': 'x' } });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('still authorizes the real owner when metadata is present', async () => {
    // The refusals above must not cost a legitimate owner their access.
    configureBlobs(true);
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-edit-token': REAL_TOKEN },
      body: { xml: '<rss>legitimate update</rss>', isDraft: true }
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still rejects a wrong token when metadata is present', async () => {
    configureBlobs(true);
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-edit-token': ATTACKER_TOKEN },
      body: { xml: '<rss>nope</rss>', isDraft: true }
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
