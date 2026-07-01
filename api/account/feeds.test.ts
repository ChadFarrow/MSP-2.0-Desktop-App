import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockGetFeedIds = vi.fn();
vi.mock('../_utils/accountStore.js', () => ({
  getAccountFeedIds: (...a: unknown[]) => mockGetFeedIds(...a)
}));

const mockHydrate = vi.fn();
vi.mock('../_utils/feedHydrate.js', () => ({
  hydrateFeedById: (...a: unknown[]) => mockHydrate(...a)
}));

import { signSession } from '../_utils/emailAuth';

function mockReqRes(method: string, headers: Record<string, string> = {}) {
  const req = { method, headers } as unknown as VercelRequest;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as VercelResponse;
  return { req, res };
}

describe('/api/account/feeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_SESSION_SECRET = 'test-session-secret-bbbbbbbbbbbbbbbb';
  });

  it('rejects non-GET with 405', async () => {
    const { default: handler } = await import('./feeds');
    const { req, res } = mockReqRes('POST');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects a missing session with 401', async () => {
    const { default: handler } = await import('./feeds');
    const { req, res } = mockReqRes('GET');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an invalid session token with 401', async () => {
    const { default: handler } = await import('./feeds');
    const { req, res } = mockReqRes('GET', { 'x-email-session': 'Bearer garbage.token.here' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns the account feeds for a valid session', async () => {
    mockGetFeedIds.mockResolvedValue(['feed-a', 'feed-b']);
    mockHydrate.mockImplementation(async (id: string) => ({ feedId: id, title: id }));
    const session = signSession('abc123');
    const { default: handler } = await import('./feeds');
    const { req, res } = mockReqRes('GET', { 'x-email-session': `Bearer ${session}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.count).toBe(2);
    expect(payload.feeds.map((f: { feedId: string }) => f.feedId)).toEqual(['feed-a', 'feed-b']);
  });

  it('drops feeds that no longer resolve', async () => {
    mockGetFeedIds.mockResolvedValue(['feed-a', 'gone']);
    mockHydrate.mockImplementation(async (id: string) => (id === 'gone' ? null : { feedId: id }));
    const session = signSession('abc123');
    const { default: handler } = await import('./feeds');
    const { req, res } = mockReqRes('GET', { 'x-email-session': `Bearer ${session}` });
    await handler(req, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.count).toBe(1);
  });
});
