import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockList = vi.fn();
vi.mock('@vercel/blob', () => ({ list: mockList, put: vi.fn(), del: vi.fn() }));

const mockStoreMagicLink = vi.fn();
vi.mock('../_utils/accountStore.js', () => ({
  storeMagicLink: (...args: unknown[]) => mockStoreMagicLink(...args)
}));

const mockSend = vi.fn();
vi.mock('../_utils/sendEmail.js', () => ({
  sendMagicLinkEmail: (...args: unknown[]) => mockSend(...args)
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { hashToken } from '../_utils/feedUtils';

function mockReqRes(method: string, body: unknown, ip = '9.9.9.9') {
  const req = { method, body, headers: { 'x-forwarded-for': ip } } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as VercelResponse;
  return { req, res };
}

const VALID_FEED_ID = '11111111-2222-3333-4444-555555555555';

describe('/api/auth/magic-link', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.MSP_EMAIL_HASH_KEY = 'test-hash-key-aaaaaaaaaaaaaaaaaaaa';
    process.env.MSP_SESSION_SECRET = 'test-session-secret-bbbbbbbbbbbbbbbb';
    mockStoreMagicLink.mockResolvedValue('raw-link-token');
    mockSend.mockResolvedValue({ ok: true });
    const { __resetRateLimiterForTests } = await import('../_utils/rateLimiter');
    __resetRateLimiterForTests();
  });

  it('rejects non-POST with 405', async () => {
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('GET', {});
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a missing/invalid email with 400', async () => {
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('POST', { email: 'not-an-email' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 {sent:true} and sends for a valid login email', async () => {
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('POST', { email: 'fan@example.com', purpose: 'login' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sent: true });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('is enumeration-safe (same 200 response regardless of address)', async () => {
    const { default: handler } = await import('./magic-link');
    const a = mockReqRes('POST', { email: 'known@example.com' });
    const b = mockReqRes('POST', { email: 'unknown@example.com' }, '8.8.8.8');
    await handler(a.req, a.res);
    await handler(b.req, b.res);
    expect(a.res.status).toHaveBeenCalledWith(200);
    expect(b.res.status).toHaveBeenCalledWith(200);
  });

  it('rate-limits repeated requests from the same IP/email with 429', async () => {
    const { default: handler } = await import('./magic-link');
    for (let i = 0; i < 5; i++) {
      const { req, res } = mockReqRes('POST', { email: 'spam@example.com' });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }
    const sixth = mockReqRes('POST', { email: 'spam@example.com' });
    await handler(sixth.req, sixth.res);
    expect(sixth.res.status).toHaveBeenCalledWith(429);
  });

  it('rejects a claim without feedId/editToken (400)', async () => {
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('POST', { email: 'owner@example.com', purpose: 'claim' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockStoreMagicLink).not.toHaveBeenCalled();
  });

  it('rejects a claim with the wrong edit token (403)', async () => {
    mockList.mockResolvedValue({ blobs: [{ pathname: `feeds/${VALID_FEED_ID}.meta.json`, url: 'https://blob/meta' }] });
    mockFetch.mockResolvedValue({ json: async () => ({ editTokenHash: hashToken('the-real-token'), title: 'My Feed' }) });
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('POST', { email: 'attacker@example.com', purpose: 'claim', feedId: VALID_FEED_ID, editToken: 'wrong-token-aaaaaaaaaaaaaaaaaaaaaaaa' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockStoreMagicLink).not.toHaveBeenCalled();
  });

  it('accepts a claim with the correct edit token and stores a claim link', async () => {
    mockList.mockResolvedValue({ blobs: [{ pathname: `feeds/${VALID_FEED_ID}.meta.json`, url: 'https://blob/meta' }] });
    mockFetch.mockResolvedValue({ json: async () => ({ editTokenHash: hashToken('the-real-token'), title: 'My Feed' }) });
    const { default: handler } = await import('./magic-link');
    const { req, res } = mockReqRes('POST', { email: 'owner@example.com', purpose: 'claim', feedId: VALID_FEED_ID, editToken: 'the-real-token' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreMagicLink).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'claim', feedId: VALID_FEED_ID }));
  });
});
