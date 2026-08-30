import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { mockReadAllDerived, mockParseAuthHeader } = vi.hoisted(() => ({
  mockReadAllDerived: vi.fn(),
  mockParseAuthHeader: vi.fn()
}));
vi.mock('../_utils/boostStore.js', () => ({ readAllDerived: mockReadAllDerived }));
vi.mock('../_utils/adminAuth.js', () => ({ parseAuthHeader: mockParseAuthHeader }));

import handler from './coverage.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

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

function derived(overrides: Partial<DerivedBoost>): DerivedBoost {
  return {
    index: 1,
    ts: Math.floor(Date.UTC(2026, 7, 29) / 1000),
    direction: 'incoming',
    actionName: 'boost',
    valueMsat: 1000,
    valueMsatTotal: 100000,
    app: 'fountain',
    isMspSplit: true,
    trackSource: 'remote-guid',
    trackKey: 'guid:a:b',
    hasMessageTitle: false,
    ...overrides
  };
}

describe('/api/boosts/coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MSP_ADMIN_KEY;
    mockParseAuthHeader.mockResolvedValue({ valid: true, pubkey: 'admin' });
    mockReadAllDerived.mockResolvedValue([]);
  });

  it('rejects anything but GET', async () => {
    const { req, res } = createMockReqRes('POST');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('refuses a caller who is neither a Nostr admin nor holding the admin key', async () => {
    mockParseAuthHeader.mockResolvedValue({ valid: false });
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockReadAllDerived).not.toHaveBeenCalled();
  });

  it('accepts the static admin key as an alternative to Nostr', async () => {
    mockParseAuthHeader.mockResolvedValue({ valid: false });
    process.env.MSP_ADMIN_KEY = 'static-admin-secret';
    const { req, res } = createMockReqRes('GET', { 'x-admin-key': 'static-admin-secret' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('separates MSP splits from everything else on the node', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, isMspSplit: true }),
      derived({ index: 2, isMspSplit: true, trackSource: 'none', trackKey: undefined }),
      derived({ index: 3, isMspSplit: false })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.totals).toEqual({ all: 3, mspSplit: 2, other: 1 });
    expect(body.msp.boosts).toBe(2);
    expect(body.msp.bySource['remote-guid']).toBe(1);
    expect(body.msp.bySource['none']).toBe(1);
    expect(body.everything.boosts).toBe(3);
  });

  it('counts only keyed sources as usable for a chart', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, trackSource: 'remote-guid', trackKey: 'guid:a:b' }),
      derived({ index: 2, trackSource: 'message', trackKey: 'title:x|y' }),
      // A playback offset is resolvable later, but it identifies nothing today.
      derived({ index: 3, trackSource: 'timesplit', trackKey: undefined }),
      derived({ index: 4, trackSource: 'none', trackKey: undefined })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { msp } = res.json.mock.calls[0][0];
    expect(msp.boosts).toBe(4);
    expect(msp.keyed).toBe(2);
    expect(msp.distinctTracks).toBe(2);
  });

  it('reports sats in sats, not millisats, for both sides of the split', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, valueMsat: 1000, valueMsatTotal: 100000 }),
      derived({ index: 2, valueMsat: 2000, valueMsatTotal: 200000 })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { msp } = res.json.mock.calls[0][0];
    expect(msp.satsTotal).toBe(300);
    expect(msp.satsReceived).toBe(3);
  });

  it('groups by ISO week and by app', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, ts: Math.floor(Date.UTC(2026, 7, 29) / 1000), app: 'fountain' }),
      derived({ index: 2, ts: Math.floor(Date.UTC(2026, 7, 29) / 1000), app: 'fountain', trackKey: 'guid:c:d' }),
      derived({ index: 3, ts: Math.floor(Date.UTC(2026, 8, 8) / 1000), app: 'curiocaster' })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { msp } = res.json.mock.calls[0][0];
    expect(msp.byWeek).toEqual([
      { week: '2026-W35', boosts: 2, tracks: 2, satsTotal: 200 },
      { week: '2026-W37', boosts: 1, tracks: 1, satsTotal: 100 }
    ]);
    expect(msp.byApp[0]).toEqual({ app: 'fountain', boosts: 2 });
  });

  it('never lets a listener field reach the response, even if one is in the store', async () => {
    // Defence in depth: toDerived() should already have dropped these, but the
    // endpoint must not echo a record it was handed.
    mockReadAllDerived.mockResolvedValue([
      { ...derived({ index: 1 }), message: 'secret boostagram', sender: 'a-real-person' }
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);

    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toContain('secret boostagram');
    expect(serialized).not.toContain('a-real-person');
  });

  it('charts only the MSP splits, and gives the node-wide view no chart at all', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, isMspSplit: true, actionName: 'stream', trackKey: 'a', trackTitle: 'Vampire' }),
      derived({ index: 2, isMspSplit: false, actionName: 'stream', trackKey: 'z', trackTitle: 'Not An MSP Feed' })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];

    expect(body.msp.topPlays).toEqual([
      { trackKey: 'a', trackTitle: 'Vampire', trackArtist: undefined, count: 1 }
    ]);
    // A diagnostic view must never be mistakable for the chart.
    expect(body.everything.topPlays).toBeUndefined();
    expect(body.everything.topBoosts).toBeUndefined();
    expect(JSON.stringify(body.msp)).not.toContain('Not An MSP Feed');
  });

  it('collapses a listener run into one play but counts each boost', async () => {
    mockReadAllDerived.mockResolvedValue([
      derived({ index: 1, actionName: 'stream', ts: 1_756_400_000, listenerKey: 'x', trackKey: 'a' }),
      derived({ index: 2, actionName: 'stream', ts: 1_756_400_060, listenerKey: 'x', trackKey: 'a' }),
      derived({ index: 3, actionName: 'stream', ts: 1_756_400_120, listenerKey: 'x', trackKey: 'a' }),
      derived({ index: 4, actionName: 'boost', trackKey: 'a' }),
      derived({ index: 5, actionName: 'auto', trackKey: 'a' })
    ]);

    const { req, res } = createMockReqRes();
    await handler(req, res);
    const { msp } = res.json.mock.calls[0][0];

    expect(msp.streamRecords).toBe(3);
    expect(msp.plays).toBe(1);
    expect(msp.topPlays[0].count).toBe(1);
    expect(msp.topBoosts[0].count).toBe(2);
  });

  it('reports a read failure rather than an empty but plausible report', async () => {
    mockReadAllDerived.mockRejectedValue(new Error('blob down'));
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
