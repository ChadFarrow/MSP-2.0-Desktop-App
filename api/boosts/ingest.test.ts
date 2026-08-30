import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const { mockStoreRaw, mockReplaceWeek, mockRebuildWeek, mockIsConfigured } = vi.hoisted(() => ({
  mockStoreRaw: vi.fn(),
  mockReplaceWeek: vi.fn(),
  mockRebuildWeek: vi.fn(),
  mockIsConfigured: vi.fn()
}));
vi.mock('../_utils/boostStore.js', () => ({
  storeRawBoosts: mockStoreRaw,
  replaceDerivedWeek: mockReplaceWeek,
  rebuildWeekFromRaw: mockRebuildWeek,
  isBoostStoreConfigured: mockIsConfigured
}));

import handler from './ingest.js';
import { __resetRateLimiterForTests } from '../_utils/rateLimiter.js';

const TOKEN = 'helipad-token-value';

type MockRes = VercelResponse & { status: Mock; json: Mock; setHeader: Mock };

function createMockReqRes(
  method: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
  ip = '9.9.9.9'
) {
  const req = {
    method,
    body,
    query: {},
    headers: { ...headers, 'x-forwarded-for': ip }
  } as unknown as VercelRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as MockRes;

  return { req, res };
}

function webhookBody(index: number) {
  return {
    direction: 'incoming',
    index,
    time: 1756400000,
    value_msat: 1000,
    value_msat_total: 100000,
    action: 2,
    app: 'fountain',
    message: '',
    podcast: 'Homegrown Hits',
    episode: 'Episode 148',
    tlv: JSON.stringify({ name: 'MSP 2.0' })
  };
}

describe('/api/boosts/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimiterForTests();
    process.env.HELIPAD_WEBHOOK_TOKEN = TOKEN;
    mockIsConfigured.mockReturnValue(true);
    mockStoreRaw.mockResolvedValue({ written: 1, duplicates: 0 });
    mockReplaceWeek.mockResolvedValue(1);
    mockRebuildWeek.mockResolvedValue(7);
  });

  it('rejects anything but POST', async () => {
    const { req, res } = createMockReqRes('GET', undefined);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('is 404 until both the token and the namespace are configured', async () => {
    delete process.env.HELIPAD_WEBHOOK_TOKEN;
    const a = createMockReqRes('POST', webhookBody(1));
    await handler(a.req, a.res);
    expect(a.res.status).toHaveBeenCalledWith(404);

    process.env.HELIPAD_WEBHOOK_TOKEN = TOKEN;
    mockIsConfigured.mockReturnValue(false);
    const b = createMockReqRes('POST', webhookBody(1));
    await handler(b.req, b.res);
    expect(b.res.status).toHaveBeenCalledWith(404);
  });

  it('rejects a missing, malformed or wrong bearer token', async () => {
    for (const headers of [{}, { authorization: TOKEN }, { authorization: 'Bearer wrong-token-x' }]) {
      const { req, res } = createMockReqRes('POST', webhookBody(1), headers);
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(mockStoreRaw).not.toHaveBeenCalled();
  });

  it('stores a single webhook body and answers exactly 200', async () => {
    const { req, res } = createMockReqRes('POST', webhookBody(10695));
    await handler(req, res);

    // Helipad counts a delivery successful only on 200. Not 201, not 204.
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw).toHaveBeenCalledTimes(1);
    const [entries, source] = mockStoreRaw.mock.calls[0];
    expect(source).toBe('webhook');
    expect(entries).toHaveLength(1);
    expect(entries[0].parsed.index).toBe(10695);
    expect(entries[0].payload).toEqual(webhookBody(10695));
  });

  it('takes an array from the import script and labels it as such', async () => {
    const { req, res } = createMockReqRes('POST', [webhookBody(1), webhookBody(2)]);
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw.mock.calls[0][1]).toBe('webhook');
    expect(mockStoreRaw.mock.calls[0][0]).toHaveLength(2);
  });

  it('counts unparseable records as skipped but still stores the rest', async () => {
    const { req, res } = createMockReqRes('POST', [webhookBody(1), { no: 'index' }]);
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, skipped: 1 }));
    expect(mockStoreRaw.mock.calls[0][0]).toHaveLength(1);
  });

  it('parses a body that arrived as a raw string instead of dropping the boost', async () => {
    // Helipad never retries, so a body Vercel did not parse must not become a 400.
    const { req, res } = createMockReqRes('POST', JSON.stringify(webhookBody(42)));
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw.mock.calls[0][0][0].parsed.index).toBe(42);
  });

  it("acknowledges Helipad's trigger test with 200 but stores nothing", async () => {
    // The Test button exists to prove the path works, so it must see a 200. Storing it
    // would park a synthetic record on index 99999, which dedup would later mistake for
    // a genuine boost carrying that index.
    const { req, res } = createMockReqRes('POST', {
      ...webhookBody(99999),
      app: 'Helipad',
      podcast: 'Test Podcast',
      message: 'This is a test trigger message'
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, tests: 1, written: 0 }));
    expect(mockStoreRaw).not.toHaveBeenCalled();
  });

  it('still stores the real records in a batch that also carries a test boost', async () => {
    const { req, res } = createMockReqRes('POST', [
      webhookBody(1),
      { ...webhookBody(99999), app: 'Helipad', podcast: 'Test Podcast', message: 'This is a test trigger message' }
    ]);
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw.mock.calls[0][0]).toHaveLength(1);
    expect(mockStoreRaw.mock.calls[0][0][0].parsed.index).toBe(1);
  });

  it('refuses a batch larger than the cap', async () => {
    const { req, res } = createMockReqRes('POST', Array.from({ length: 501 }, (_, i) => webhookBody(i)));
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockStoreRaw).not.toHaveBeenCalled();
  });

  it('refuses a payload where nothing carries a usable index', async () => {
    const { req, res } = createMockReqRes('POST', { direction: 'incoming', tlv: '{}' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('writes a whole week when sent the week envelope, and reports its stored size', async () => {
    mockReplaceWeek.mockResolvedValue(2);
    const { req, res } = createMockReqRes('POST', {
      week: '2025-W35',
      records: [webhookBody(1), webhookBody(2)]
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw.mock.calls[0][1]).toBe('import');
    expect(mockReplaceWeek).toHaveBeenCalledWith('2025-W35', expect.arrayContaining([
      expect.objectContaining({ index: 1 })
    ]));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ weekSizes: { '2025-W35': 2 } }));
  });

  it("rebuilds a webhook's week from raw, passing the record it just received", async () => {
    // A webhook knows one boost, not a week, so it cannot use the whole-week write. It
    // rebuilds from raw instead — no merge, no read of the previous derived file — and
    // hands its own record through, because list() may not show it yet.
    const { req, res } = createMockReqRes('POST', webhookBody(10695));
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReplaceWeek).not.toHaveBeenCalled();
    expect(mockRebuildWeek).toHaveBeenCalledTimes(1);
    const [week, extras] = mockRebuildWeek.mock.calls[0];
    expect(week).toBe('2025-W35');
    expect(extras.map((r: { index: number }) => r.index)).toEqual([10695]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ weekSizes: { '2025-W35': 7 } }));
  });

  it("uses the whole-week write for the importer, never a rebuild", async () => {
    const { req, res } = createMockReqRes('POST', { week: '2025-W35', records: [webhookBody(1)] });
    await handler(req, res);
    expect(mockReplaceWeek).toHaveBeenCalledTimes(1);
    expect(mockRebuildWeek).not.toHaveBeenCalled();
  });

  it('refuses a record that is not in the stated week rather than dropping it', async () => {
    // The rewrite replaces the file outright, so a stray record would vanish silently.
    const { req, res } = createMockReqRes('POST', {
      week: '2025-W35',
      records: [webhookBody(1), { ...webhookBody(2), time: Math.floor(Date.UTC(2020, 0, 8) / 1000) }]
    });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockReplaceWeek).not.toHaveBeenCalled();
  });

  it('rejects a malformed week key', async () => {
    for (const week of ['2026-35', 'last week', '', 26]) {
      const { req, res } = createMockReqRes('POST', { week, records: [webhookBody(1)] });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockReplaceWeek).not.toHaveBeenCalled();
  });

  it('rate limits per IP once the hourly budget is spent', async () => {
    for (let i = 0; i < 600; i++) {
      const { req, res } = createMockReqRes('POST', webhookBody(i));
      await handler(req, res);
    }
    const { req, res } = createMockReqRes('POST', webhookBody(601));
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('reports a storage failure as a 500 rather than a false success', async () => {
    mockStoreRaw.mockRejectedValue(new Error('blob down'));
    const { req, res } = createMockReqRes('POST', webhookBody(1));
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
