import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { mockReadAllDerived } = vi.hoisted(() => ({ mockReadAllDerived: vi.fn() }));
vi.mock('../_utils/boostStore.js', () => ({ readAllDerived: mockReadAllDerived }));

import handler from './chart.js';
import { __resetRateLimiterForTests } from '../_utils/rateLimiter.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

type MockRes = VercelResponse & { status: Mock; json: Mock; setHeader: Mock };

function createMockReqRes(method = 'GET', ip = '5.5.5.5') {
  const req = { method, query: {}, headers: { 'x-forwarded-for': ip } } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as MockRes;
  return { req, res };
}

const AUG = Math.floor(Date.UTC(2026, 7, 12) / 1000);
const JUL = Math.floor(Date.UTC(2026, 6, 12) / 1000);

function rec(overrides: Partial<DerivedBoost>): DerivedBoost {
  return {
    index: 1,
    ts: AUG,
    direction: 'incoming',
    actionName: 'boost',
    valueMsat: 1000,
    valueMsatTotal: 100000,
    app: 'fountain',
    isMspSplit: true,
    trackSource: 'remote-guid',
    trackKey: 'guid:a:b',
    trackTitle: 'Bakalator',
    trackArtist: 'Bacalao',
    hasMessageTitle: false,
    ...overrides
  };
}

describe('/api/boosts/chart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimiterForTests();
    mockReadAllDerived.mockResolvedValue([]);
  });

  it('rejects anything but GET', async () => {
    const { req, res } = createMockReqRes('POST');
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('charts only MSP splits', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, isMspSplit: true, trackKey: 'a', trackTitle: 'Mine' }),
      rec({ index: 2, isMspSplit: false, trackKey: 'z', trackTitle: 'Not An MSP Feed' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).toContain('Mine');
    expect(body).not.toContain('Not An MSP Feed');
  });

  it('publishes counts and never any sats figure', async () => {
    // Chad's call: the chart is about what people listened to, not what anyone earned.
    mockReadAllDerived.mockResolvedValue([rec({ valueMsat: 123456, valueMsatTotal: 987654 })]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('123456');
    expect(body).not.toContain('987654');
    expect(body).not.toMatch(/sats?"/i);
    expect(body).not.toContain('valueMsat');
  });

  it('carries no listener field and no internal track key', async () => {
    mockReadAllDerived.mockResolvedValue([rec({ listenerKey: 'abc123def456' })]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('abc123def456');
    expect(body).not.toContain('listenerKey');
    expect(body).not.toContain('trackKey');
  });

  it('omits records that resolve to no title, but still counts them in the totals', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, trackKey: 'a', trackTitle: 'Named' }),
      rec({ index: 2, trackKey: 'b', trackTitle: undefined })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { allTime } = res.json.mock.calls[0][0];
    expect(allTime.boosts.map((r: { title: string }) => r.title)).toEqual(['Named']);
    expect(allTime.totalBoosts).toBe(2);
  });

  it('groups by calendar month, newest first', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUL, trackKey: 'a', trackTitle: 'July Song' }),
      rec({ index: 2, ts: AUG, trackKey: 'b', trackTitle: 'August Song' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { months } = res.json.mock.calls[0][0];
    expect(months.map((m: { month: string }) => m.month)).toEqual(['2026-08', '2026-07']);
    expect(months[0].label).toBe('August 2026');
    expect(months[0].boosts[0].title).toBe('August Song');
  });

  it('collapses a listener run into one play, and keeps plays apart from boosts', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, actionName: 'stream', ts: AUG, listenerKey: 'x', trackKey: 'a', trackTitle: 'Streamed' }),
      rec({ index: 2, actionName: 'stream', ts: AUG + 60, listenerKey: 'x', trackKey: 'a', trackTitle: 'Streamed' }),
      rec({ index: 3, actionName: 'boost', ts: AUG, trackKey: 'b', trackTitle: 'Boosted' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { allTime } = res.json.mock.calls[0][0];
    expect(allTime.streams).toEqual([{ title: 'Streamed', artist: 'Bacalao', count: 1 }]);
    expect(allTime.boosts).toEqual([{ title: 'Boosted', artist: 'Bacalao', count: 1 }]);
  });

  it("caps nothing — a month shows every track it has, same as all time", async () => {
    // A top ten was hiding real data rather than tidying it: across the live months it
    // truncated 5 of 16 lists, and June showed 10 of its 28 boosted tracks.
    const many = Array.from({ length: 14 }, (_, i) =>
      Array.from({ length: 14 - i }, (_, n) =>
        rec({ index: i * 100 + n, trackKey: "t" + i, trackTitle: "Track " + i })));
    mockReadAllDerived.mockResolvedValue(many.flat());

    const { req, res } = createMockReqRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];

    expect(body.allTime.boosts).toHaveLength(14);
    expect(body.months[0].boosts).toHaveLength(14);
    // Still ranked, not merely unsliced.
    expect(body.allTime.boosts[0].count).toBeGreaterThan(body.allTime.boosts[13].count);
  });

  it("reports the stream count as streams, because \"0 plays\" reads like a bug", async () => {
    mockReadAllDerived.mockResolvedValue([rec({ actionName: "boost" })]);
    const { req, res } = createMockReqRes();
    await handler(req, res);
    const body = res.json.mock.calls[0][0];

    expect(body.allTime.totalStreams).toBe(0);
    expect(body.allTime).not.toHaveProperty("totalPlays");
    expect(body.allTime).not.toHaveProperty("plays");
  });

  it('caches briefly, so a boost shows up while someone is still on the page', async () => {
    // The webhook rebuilds a week in seconds, so an hour of page cache would hide it.
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      expect.stringContaining('s-maxage=300')
    );
  });

  it('rate limits an abusive caller', async () => {
    for (let i = 0; i < 120; i++) {
      const { req, res } = createMockReqRes();
      await handler(req, res);
    }
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('reports a read failure rather than an empty but plausible chart', async () => {
    mockReadAllDerived.mockRejectedValue(new Error('blob down'));
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
