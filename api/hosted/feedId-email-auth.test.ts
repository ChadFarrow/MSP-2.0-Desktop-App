import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockList = vi.fn();
const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock('@vercel/blob', () => ({ list: mockList, put: mockPut, del: mockDel }));

const mockAddFeed = vi.fn();
const mockRemoveFeed = vi.fn();
vi.mock('../_utils/accountStore.js', () => ({
  addFeedToAccount: (...a: unknown[]) => mockAddFeed(...a),
  removeFeedFromAccount: (...a: unknown[]) => mockRemoveFeed(...a)
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { hashToken } from '../_utils/feedUtils';
import { signSession, emailHash } from '../_utils/emailAuth';

const FEED = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'owner@example.com';
const REAL_TOKEN = 'the-real-edit-token-aaaaaaaaaaaaaaaa';

function meta(extra: Record<string, unknown> = {}) {
  return {
    editTokenHash: hashToken(REAL_TOKEN),
    createdAt: '1',
    title: 'My Feed',
    ownerEmailHash: emailHash(EMAIL),
    ...extra
  };
}

function configureBlobs(metaObj: Record<string, unknown> | null) {
  mockList.mockImplementation(({ prefix }: { prefix: string }) => {
    if (prefix === `feeds/${FEED}.meta.json`) {
      return Promise.resolve({ blobs: metaObj ? [{ pathname: `feeds/${FEED}.meta.json`, url: 'https://blob/meta' }] : [] });
    }
    if (prefix === `feeds/${FEED}.xml`) {
      return Promise.resolve({ blobs: [{ pathname: `feeds/${FEED}.xml`, url: 'https://blob/xml' }] });
    }
    return Promise.resolve({ blobs: [] }); // backups, etc.
  });
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('meta')) {
      return Promise.resolve({ text: async () => (metaObj ? JSON.stringify(metaObj) : ''), json: async () => metaObj ?? {} });
    }
    return Promise.resolve({ text: async () => '<rss>feed</rss>' });
  });
}

function reqRes(method: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const req = { method, query: { feedId: FEED }, headers: opts.headers ?? {}, body: opts.body } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;
  return { req, res };
}

describe('hosted [feedId] email-session auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_EMAIL_HASH_KEY = 'test-hash-key-aaaaaaaaaaaaaaaaaaaa';
    process.env.MSP_SESSION_SECRET = 'test-session-secret-bbbbbbbbbbbbbbbb';
    mockPut.mockResolvedValue({});
    mockDel.mockResolvedValue({});
    mockAddFeed.mockResolvedValue(undefined);
    mockRemoveFeed.mockResolvedValue(undefined);
  });

  it('PUT: authorizes the email owner with a valid session', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-email-session': `Bearer ${signSession(emailHash(EMAIL))}` },
      body: { xml: '<rss>new</rss>', isDraft: true }
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('PUT: rejects a session for a different email with 403', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-email-session': `Bearer ${signSession(emailHash('someone-else@example.com'))}` },
      body: { xml: '<rss>new</rss>', isDraft: true }
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('PUT: preserves ownerEmailHash in the written metadata', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PUT', {
      headers: { 'x-email-session': `Bearer ${signSession(emailHash(EMAIL))}` },
      body: { xml: '<rss>new</rss>', isDraft: true }
    });
    await handler(req, res);
    const metaWrite = mockPut.mock.calls.find(c => String(c[0]).endsWith('.meta.json'));
    expect(metaWrite).toBeTruthy();
    expect(JSON.parse(metaWrite![1]).ownerEmailHash).toBe(emailHash(EMAIL));
  });

  it('DELETE: authorizes the email owner and de-indexes the feed', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('DELETE', {
      headers: { 'x-email-session': `Bearer ${signSession(emailHash(EMAIL))}` }
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRemoveFeed).toHaveBeenCalledWith(emailHash(EMAIL), FEED);
  });

  it('DELETE: rejects with 401 when no credentials are supplied', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('DELETE', { headers: {} });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('PATCH: links an email identity when given a valid token + session', async () => {
    configureBlobs(meta({ ownerEmailHash: undefined }));
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PATCH', {
      headers: {
        'x-edit-token': REAL_TOKEN,
        'x-email-session': `Bearer ${signSession(emailHash(EMAIL))}`
      }
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockAddFeed).toHaveBeenCalledWith(emailHash(EMAIL), FEED);
    const metaWrite = mockPut.mock.calls.find(c => String(c[0]).endsWith('.meta.json'));
    expect(JSON.parse(metaWrite![1]).ownerEmailHash).toBe(emailHash(EMAIL));
  });

  it('PATCH: rejects a wrong edit token with 403', async () => {
    configureBlobs(meta());
    const { default: handler } = await import('./[feedId]');
    const { req, res } = reqRes('PATCH', {
      headers: {
        'x-edit-token': 'wrong-token',
        'x-email-session': `Bearer ${signSession(emailHash(EMAIL))}`
      }
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
