import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { mockRebuild, mockIsConfigured, mockParseAuthHeader } = vi.hoisted(() => ({
  mockRebuild: vi.fn(),
  mockIsConfigured: vi.fn(),
  mockParseAuthHeader: vi.fn()
}));
vi.mock('../_utils/boostStore.js', () => ({
  rebuildWeekFromRaw: mockRebuild,
  isBoostStoreConfigured: mockIsConfigured
}));
vi.mock('../_utils/adminAuth.js', () => ({ parseAuthHeader: mockParseAuthHeader }));

import handler from './rebuild.js';

const CRON_SECRET = 'cron-secret-value';

type MockRes = VercelResponse & { status: Mock; json: Mock; setHeader: Mock };

function createMockReqRes(method = 'GET', headers: Record<string, string> = {}) {
  const req = { method, query: {}, headers } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as MockRes;
  return { req, res };
}

describe('/api/boosts/rebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    delete process.env.MSP_ADMIN_KEY;
    mockIsConfigured.mockReturnValue(true);
    mockParseAuthHeader.mockResolvedValue({ valid: false });
    mockRebuild.mockResolvedValue(42);
  });

  it('rejects anything but GET, which is what Vercel Cron sends', async () => {
    const { req, res } = createMockReqRes('POST', { authorization: `Bearer ${CRON_SECRET}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('is 404 until the boost store is configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const { req, res } = createMockReqRes('GET', { authorization: `Bearer ${CRON_SECRET}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('accepts the Vercel Cron bearer token', async () => {
    const { req, res } = createMockReqRes('GET', { authorization: `Bearer ${CRON_SECRET}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accepts the static admin key for a manual run', async () => {
    process.env.MSP_ADMIN_KEY = 'admin-key-value';
    const { req, res } = createMockReqRes('GET', { 'x-admin-key': 'admin-key-value' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accepts a Nostr admin', async () => {
    mockParseAuthHeader.mockResolvedValue({ valid: true, pubkey: 'admin' });
    const { req, res } = createMockReqRes('GET', { authorization: 'Nostr abc' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refuses an unauthenticated caller', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong-secret' }, { 'x-admin-key': 'nope' }]) {
      const { req, res } = createMockReqRes('GET', headers);
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it('never falls back to open when CRON_SECRET is unset', async () => {
    // The failure mode that matters for an endpoint which rewrites stored data.
    delete process.env.CRON_SECRET;
    const { req, res } = createMockReqRes('GET', { authorization: 'Bearer ' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it('rebuilds this week and last week, and nothing older', async () => {
    const { req, res } = createMockReqRes('GET', { authorization: `Bearer ${CRON_SECRET}` });
    await handler(req, res);

    expect(mockRebuild).toHaveBeenCalledTimes(2);
    const weeks = mockRebuild.mock.calls.map(c => c[0]);
    expect(new Set(weeks).size).toBe(2);
    for (const week of weeks) expect(week).toMatch(/^\d{4}-W\d{2}$/);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('reports a failure rather than a silent partial rebuild', async () => {
    mockRebuild.mockRejectedValue(new Error('blob down'));
    const { req, res } = createMockReqRes('GET', { authorization: `Bearer ${CRON_SECRET}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
