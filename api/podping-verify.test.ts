import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const FEED_URL = 'https://musicsideproject.com/api/hosted/abc.xml';

function createMockReqRes(
  method: string,
  query: Record<string, string | undefined>,
  ip = '1.2.3.4'
) {
  const req = {
    method,
    query,
    headers: { 'x-forwarded-for': ip }
  } as unknown as VercelRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis()
  } as unknown as VercelResponse & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };

  return { req, res };
}

/** One entry in a condenser_api.get_account_history result array. */
function historyEntry(
  index: number,
  id: string,
  json: string,
  overrides: { trx_id?: string; block?: number; timestamp?: string } = {}
) {
  return [
    index,
    {
      trx_id: overrides.trx_id ?? `trx${index}`,
      block: overrides.block ?? 9000000 + index,
      timestamp: overrides.timestamp ?? '2026-07-25T12:00:00',
      op: ['custom_json', { id, json, required_posting_auths: ['mspaccount'] }]
    }
  ];
}

function podpingJson(...urls: string[]) {
  return JSON.stringify({
    version: '1.1',
    medium: 'music',
    reason: 'update',
    iris: urls
  });
}

function mockRpcResult(result: unknown) {
  return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
}

describe('/api/podping-verify', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.PODPING_HIVE_ACCOUNT;
    delete process.env.PODPING_HIVE_RPC_URL;

    const { __resetRateLimiterForTests } = await import('./_utils/rateLimiter');
    __resetRateLimiterForTests();
  });

  it('rejects non-GET methods with 405', async () => {
    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('POST', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 400 when url is missing', async () => {
    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', {});

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for invalid URL format', async () => {
    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: 'not-a-url' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 501 when PODPING_HIVE_ACCOUNT is unset', async () => {
    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns landed:true with tx details when a matching podping op is found', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([
        historyEntry(1, 'pp_music_update', podpingJson('https://other.example/feed.xml')),
        historyEntry(2, 'pp_music_update', podpingJson(FEED_URL), {
          trx_id: 'deadbeef',
          block: 9482113,
          timestamp: '2026-07-25T12:34:56'
        })
      ])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      landed: true,
      account: 'mspaccount',
      trxId: 'deadbeef',
      block: 9482113,
      timestamp: '2026-07-25T12:34:56'
    });
  });

  it('matches a batched op carrying several feed URLs', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([
        historyEntry(
          1,
          'pp_music_update',
          podpingJson('https://other.example/feed.xml', FEED_URL)
        )
      ])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ landed: true }));
  });

  it('returns the newest match when the URL appears in several ops', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([
        historyEntry(1, 'pp_music_update', podpingJson(FEED_URL), { trx_id: 'older' }),
        historyEntry(2, 'pp_music_update', podpingJson(FEED_URL), { trx_id: 'newer' })
      ])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ trxId: 'newer' }));
  });

  it('returns landed:false when no op carries the feed URL', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([
        historyEntry(1, 'pp_music_update', podpingJson('https://other.example/feed.xml'))
      ])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ landed: false, account: 'mspaccount' });
  });

  it('ignores non-podping custom_json ops that mention the URL', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([historyEntry(1, 'notify', JSON.stringify({ url: FEED_URL }))])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ landed: false, account: 'mspaccount' });
  });

  it('ignores non-custom_json operations', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([
        [1, { trx_id: 'x', block: 1, timestamp: 't', op: ['transfer', { memo: FEED_URL }] }]
      ])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ landed: false, account: 'mspaccount' });
  });

  it('falls back to the next Hive node when the first one fails', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        mockRpcResult([historyEntry(1, 'pp_music_update', podpingJson(FEED_URL))])
      );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ landed: true }));
  });

  it('returns 502 — never landed:false — when every Hive node fails', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockRejectedValue(new Error('network down'));

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ landed: false }));
  });

  it('treats a JSON-RPC error payload as a node failure', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'bad account' } })
    });

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('uses only PODPING_HIVE_RPC_URL when it is set', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    process.env.PODPING_HIVE_RPC_URL = 'https://hive.example/rpc';
    mockFetch.mockResolvedValueOnce(
      mockRpcResult([historyEntry(1, 'pp_music_update', podpingJson(FEED_URL))])
    );

    const { default: handler } = await import('./podping-verify');
    const { req, res } = createMockReqRes('GET', { url: FEED_URL });

    await handler(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://hive.example/rpc', expect.anything());
  });

  it('returns 429 with Retry-After on the 61st request from the same IP', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    mockFetch.mockResolvedValue(mockRpcResult([]));

    const { default: handler } = await import('./podping-verify');

    for (let i = 0; i < 60; i++) {
      const { req, res } = createMockReqRes('GET', { url: FEED_URL });
      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    }

    const { req, res } = createMockReqRes('GET', { url: FEED_URL });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('does not share a rate-limit bucket with /api/podping', async () => {
    process.env.PODPING_HIVE_ACCOUNT = 'mspaccount';
    process.env.PODPING_ENDPOINT_URL = 'https://podping.example/';
    process.env.PODPING_BEARER_TOKEN = 'secret';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ jsonrpc: '2.0', id: 1, result: [] })
    });

    const { default: podpingHandler } = await import('./podping');
    const { default: verifyHandler } = await import('./podping-verify');

    // Exhaust /api/podping's 10/hour budget for this IP.
    for (let i = 0; i < 10; i++) {
      const { req, res } = createMockReqRes('GET', { url: FEED_URL }, '9.9.9.9');
      await podpingHandler(req, res);
    }

    const { req, res } = createMockReqRes('GET', { url: FEED_URL }, '9.9.9.9');
    await verifyHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    delete process.env.PODPING_ENDPOINT_URL;
    delete process.env.PODPING_BEARER_TOKEN;
  });
});
