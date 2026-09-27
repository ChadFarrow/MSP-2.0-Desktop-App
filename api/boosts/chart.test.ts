import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { mockReadAllDerived, mockParseAuthHeader } = vi.hoisted(() => ({
  mockReadAllDerived: vi.fn(),
  mockParseAuthHeader: vi.fn()
}));
vi.mock('../_utils/boostStore.js', () => ({ readAllDerived: mockReadAllDerived }));
vi.mock('../_utils/adminAuth.js', () => ({ parseAuthHeader: mockParseAuthHeader }));

import handler from './chart.js';
import { __resetRateLimiterForTests } from '../_utils/rateLimiter.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

type MockRes = VercelResponse & { status: Mock; json: Mock; setHeader: Mock };

function createMockReqRes(method = 'GET', ip = '5.5.5.5', headers: Record<string, string> = {}) {
  const req = { method, query: {}, headers: { 'x-forwarded-for': ip, ...headers } } as unknown as VercelRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as MockRes;
  return { req, res };
}

const AUG = Math.floor(Date.UTC(2026, 7, 12) / 1000);
const JUL = Math.floor(Date.UTC(2026, 6, 12) / 1000);
const JUN = Math.floor(Date.UTC(2026, 5, 12) / 1000);
const OCT = Math.floor(Date.UTC(2026, 9, 12) / 1000);

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
    delete process.env.MSP_ADMIN_KEY;
    mockParseAuthHeader.mockResolvedValue({ valid: true, pubkey: 'admin' });
    mockReadAllDerived.mockResolvedValue([]);
    // "This month" ends the trend, so the tests fix it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 12)));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const { req, res } = createMockReqRes('GET', '5.5.5.5', { 'x-admin-key': 'static-admin-secret' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
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

  it('says which spellings a merged row absorbed, and says nothing on an unmerged one', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' }),
      rec({ index: 2, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      rec({ index: 3, trackKey: 'guid:c', trackTitle: 'Bakalator', trackArtist: 'Bacalao' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const rows = res.json.mock.calls[0][0].allTime.boosts;
    const merged = rows.find((r: { title: string }) => r.title === 'Copenhagen Time');
    const single = rows.find((r: { title: string }) => r.title === 'Bakalator');
    expect(merged).toMatchObject({ count: 2, artist: 'Kulture Collection - Matt Finlay', mergedFrom: ['Matt Finlay'] });
    expect(single).not.toHaveProperty('mergedFrom');
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
    expect(allTime.streams).toEqual([{ title: 'Streamed', artist: 'Bacalao', count: 1, listeners: 1, unattributed: 0, trend: [1, 0] }]);
    expect(allTime.boosts).toEqual([{ title: 'Boosted', artist: 'Bacalao', count: 1, listeners: 0, unattributed: 1, trend: [1, 0] }]);
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

  it('keeps the admin-only chart out of every shared cache', async () => {
    // A CDN copy of an authenticated response would be served to anyone who asks.
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).not.toHaveBeenCalledWith('Cache-Control', expect.stringContaining('s-maxage'));
  });

  it('keeps a refusal out of shared caches too', async () => {
    mockParseAuthHeader.mockResolvedValue({ valid: false });
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
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

  it('counts listeners on each row and for the period, and publishes no key', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, listenerKey: '0123456789abcdef', trackKey: 'a', trackTitle: 'Popular' }),
      rec({ index: 2, listenerKey: '0123456789abcdef', trackKey: 'a', trackTitle: 'Popular' }),
      rec({ index: 3, listenerKey: 'fedcba9876543210', trackKey: 'a', trackTitle: 'Popular' }),
      rec({ index: 4, listenerKey: undefined, trackKey: 'a', trackTitle: 'Popular' }),
      rec({ index: 5, listenerKey: 'fedcba9876543210', trackKey: 'b', trackTitle: undefined })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.allTime.boosts[0]).toMatchObject({ title: 'Popular', count: 4, listeners: 2, unattributed: 1 });
    // The period counts every counted record, named or not, as the totals do.
    expect(body.allTime).toMatchObject({ listeners: 2, unattributed: 1 });
    const text = JSON.stringify(body);
    expect(text).not.toContain('0123456789abcdef');
    expect(text).not.toContain('fedcba9876543210');
  });

  it('lists artists beside songs, for boosts and streams alike', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay', listenerKey: 'k1' }),
      rec({ index: 2, trackKey: 'b', trackTitle: 'Safe And Effective', trackArtist: 'Kulture Collection', listenerKey: 'k1' }),
      rec({ index: 3, actionName: 'stream', trackKey: 'c', trackTitle: 'Vampire', trackArtist: 'Feeling the Light', listenerKey: 'k2' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { allTime } = res.json.mock.calls[0][0];
    expect(allTime.artistBoosts).toEqual([
      { artist: 'Matt Finlay', count: 2, songs: 2, listeners: 1, unattributed: 0, mergedFrom: ['Kulture Collection'], trend: [2, 0] }
    ]);
    expect(allTime.artistStreams).toEqual([
      { artist: 'Feeling the Light', count: 1, songs: 1, listeners: 1, unattributed: 0, trend: [1, 0] }
    ]);
  });

  it('gives an album-only song in a month the artist that all time knows for it', async () => {
    // July names the album and the artist together; August has only the album. Grouped
    // on August alone, the album would stand as an artist of its own.
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUL, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' }),
      rec({ index: 2, ts: AUG, trackKey: 'b', trackTitle: 'Safe And Effective', trackArtist: 'Kulture Collection' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const august = res.json.mock.calls[0][0].months.find((m: { month: string }) => m.month === '2026-08');
    expect(august.artistBoosts).toEqual([
      expect.objectContaining({ artist: 'Matt Finlay', mergedFrom: ['Kulture Collection'] })
    ]);
  });

  it('marks a song new only in the month of its first support, and never in all time', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUN, trackKey: 'c', trackTitle: 'First Month Song', trackArtist: 'Band C' }),
      rec({ index: 2, ts: JUL, trackKey: 'a', trackTitle: 'Old Favourite', trackArtist: 'Band A' }),
      rec({ index: 3, ts: AUG, trackKey: 'a', trackTitle: 'Old Favourite', trackArtist: 'Band A' }),
      rec({ index: 4, ts: AUG, trackKey: 'b', trackTitle: 'Fresh Song', trackArtist: 'Band B' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = res.json.mock.calls[0][0];
    const month = (m: string) => body.months.find((x: { month: string }) => x.month === m);
    const row = (m: string, title: string) => month(m).boosts.find((r: { title: string }) => r.title === title);
    expect(row('2026-08', 'Fresh Song').isNew).toBe(true);
    expect(row('2026-08', 'Old Favourite')).not.toHaveProperty('isNew');
    expect(row('2026-07', 'Old Favourite').isNew).toBe(true);
    // Everything in the first month with data would be "new", which says nothing.
    expect(row('2026-06', 'First Month Song')).not.toHaveProperty('isNew');
    expect(JSON.stringify(body.allTime)).not.toContain('isNew');
  });

  it('does not call a song new when another spelling of it was supported earlier', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUN, trackKey: 'x', trackTitle: 'Something Else', trackArtist: 'Band X' }),
      rec({ index: 2, ts: JUL, trackKey: 'guid:b', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection' }),
      rec({ index: 3, ts: AUG, trackKey: 'link:a', trackTitle: 'Copenhagen Time', trackArtist: 'Kulture Collection - Matt Finlay' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const august = res.json.mock.calls[0][0].months.find((m: { month: string }) => m.month === '2026-08');
    expect(august.boosts[0]).toMatchObject({ title: 'Copenhagen Time' });
    expect(august.boosts[0]).not.toHaveProperty('isNew');
  });

  it("marks an artist new only in the month of the artist's first support", async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUN, trackKey: 'x', trackTitle: 'Something Else', trackArtist: 'Band X' }),
      rec({ index: 2, ts: JUL, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      rec({ index: 3, ts: AUG, trackKey: 'b', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' }),
      rec({ index: 4, ts: AUG, trackKey: 'c', trackTitle: 'Vampire', trackArtist: 'Feeling the Light' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const august = res.json.mock.calls[0][0].months.find((m: { month: string }) => m.month === '2026-08');
    const artist = (name: string) => august.artistBoosts.find((a: { artist: string }) => a.artist === name);
    // A new song by an artist already supported is a new song, not a new artist.
    expect(august.boosts.find((r: { title: string }) => r.title === 'Contrails').isNew).toBe(true);
    expect(artist('Matt Finlay')).not.toHaveProperty('isNew');
    expect(artist('Feeling the Light').isNew).toBe(true);
  });

  it('draws the trend from the first month with data to this month, with no gaps', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUN, listenerKey: 'k1', trackKey: 'a', trackTitle: 'Song A' }),
      rec({ index: 2, ts: AUG, listenerKey: 'k1', trackKey: 'a', trackTitle: 'Song A' }),
      rec({ index: 3, ts: AUG, listenerKey: 'k2', trackKey: 'b', trackTitle: 'Song B' }),
      rec({ index: 4, ts: AUG, listenerKey: 'k3', actionName: 'stream', trackKey: 's', trackTitle: 'Streamed' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { trend } = res.json.mock.calls[0][0];
    // July had nothing and September has nothing yet: both are zeros, not gaps, or the
    // graph would join June to August and hide the quiet months.
    expect(trend.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(trend.boosts).toEqual([1, 0, 2, 0]);
    expect(trend.streams).toEqual([0, 0, 1, 0]);
    expect(trend.listeners).toEqual([1, 0, 3, 0]);
  });

  it('says from which month the counts are complete', async () => {
    // Before msp-bot took over on 2026-01-29 the records are Helipad's, which missed
    // LNURL boosts; a trend across that line would show growth that is only a new source.
    mockReadAllDerived.mockResolvedValue([rec({})]);
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.json.mock.calls[0][0].trend.completeFrom).toBe('2026-02');
  });

  it('runs the trend past this month when a record is dated later', async () => {
    mockReadAllDerived.mockResolvedValue([rec({ ts: OCT })]);
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.json.mock.calls[0][0].trend.months).toEqual(['2026-10']);
  });

  it('has an empty trend when there is nothing to chart', async () => {
    const { req, res } = createMockReqRes();
    await handler(req, res);
    expect(res.json.mock.calls[0][0].trend).toMatchObject({ months: [], boosts: [], streams: [], listeners: [] });
  });

  it('gives each all-time song its count for each month, and a month view no trend', async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUN, trackKey: 'a', trackTitle: 'Song A' }),
      rec({ index: 2, ts: AUG, trackKey: 'a', trackTitle: 'Song A' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.allTime.boosts[0].trend).toEqual([1, 0, 1, 0]);
    expect(JSON.stringify(body.months)).not.toContain('trend');
  });

  it("gives each all-time artist the monthly counts of the artist's songs", async () => {
    mockReadAllDerived.mockResolvedValue([
      rec({ index: 1, ts: JUL, trackKey: 'a', trackTitle: 'Copenhagen Time', trackArtist: 'Matt Finlay' }),
      rec({ index: 2, ts: AUG, trackKey: 'b', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' }),
      rec({ index: 3, ts: AUG, actionName: 'stream', trackKey: 'b', trackTitle: 'Contrails', trackArtist: 'Matt Finlay' })
    ]);
    const { req, res } = createMockReqRes();
    await handler(req, res);

    const { allTime } = res.json.mock.calls[0][0];
    expect(allTime.artistBoosts[0].trend).toEqual([1, 1, 0]);
    expect(allTime.artistStreams[0].trend).toEqual([0, 1, 0]);
  });
});
