import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockList = vi.fn();
const mockPut = vi.fn();
vi.mock('@vercel/blob', () => ({ list: mockList, put: mockPut, del: vi.fn() }));

const mockRedeem = vi.fn();
const mockAddFeed = vi.fn();
vi.mock('../_utils/accountStore.js', () => ({
  redeemMagicLink: (...a: unknown[]) => mockRedeem(...a),
  addFeedToAccount: (...a: unknown[]) => mockAddFeed(...a)
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { verifySession } from '../_utils/emailAuth';

function mockReqRes(method: string, body: unknown) {
  const req = { method, body, headers: {} } as unknown as VercelRequest;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as VercelResponse;
  return { req, res };
}

const EMAIL_HASH = 'abc123';
const FEED_ID = '11111111-2222-3333-4444-555555555555';

describe('/api/auth/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_SESSION_SECRET = 'test-session-secret-bbbbbbbbbbbbbbbb';
    mockPut.mockResolvedValue({});
    mockAddFeed.mockResolvedValue(undefined);
  });

  it('rejects non-POST with 405', async () => {
    const { default: handler } = await import('./verify');
    const { req, res } = mockReqRes('GET', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a missing token with 400', async () => {
    const { default: handler } = await import('./verify');
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an invalid/expired token with 400', async () => {
    mockRedeem.mockResolvedValue(null);
    const { default: handler } = await import('./verify');
    const { req, res } = mockReqRes('POST', { token: 'expired' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('mints a valid session for a login link', async () => {
    mockRedeem.mockResolvedValue({ purpose: 'login', emailHash: EMAIL_HASH });
    const { default: handler } = await import('./verify');
    const { req, res } = mockReqRes('POST', { token: 'good' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.emailHash).toBe(EMAIL_HASH);
    const v = verifySession(payload.session);
    expect(v.valid).toBe(true);
    expect(v.emailHash).toBe(EMAIL_HASH);
    expect(mockPut).not.toHaveBeenCalled(); // login does not touch feed meta
  });

  it('stamps ownerEmailHash and indexes the feed for a claim link', async () => {
    mockRedeem.mockResolvedValue({ purpose: 'claim', emailHash: EMAIL_HASH, feedId: FEED_ID });
    mockList.mockResolvedValue({ blobs: [{ pathname: `feeds/${FEED_ID}.meta.json`, url: 'https://blob/meta' }] });
    mockFetch.mockResolvedValue({ json: async () => ({ editTokenHash: 'x', title: 'Feed' }) });
    const { default: handler } = await import('./verify');
    const { req, res } = mockReqRes('POST', { token: 'good-claim' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockPut).toHaveBeenCalledOnce();
    const written = JSON.parse(mockPut.mock.calls[0][1]);
    expect(written.ownerEmailHash).toBe(EMAIL_HASH);
    expect(written.emailLinkedAt).toBeTruthy();
    expect(mockAddFeed).toHaveBeenCalledWith(EMAIL_HASH, FEED_ID);
  });
});
