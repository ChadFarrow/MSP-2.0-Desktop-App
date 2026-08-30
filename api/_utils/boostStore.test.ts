import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPut, mockList } = vi.hoisted(() => ({ mockPut: vi.fn(), mockList: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: mockPut, list: mockList }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isBoostStoreConfigured,
  rawPath,
  derivedPath,
  storeBoosts
} from './boostStore.js';
import { parseBoostPayload } from './boostRecord.js';
import type { ParsedBoost } from './boostRecord.js';

const NAMESPACE = 'abcdefghijklmnop0123';

function boost(index: number, overrides: Record<string, unknown> = {}): ParsedBoost {
  return parseBoostPayload({
    direction: 'incoming',
    index,
    time: Math.floor(Date.UTC(2026, 7, 29) / 1000),
    value_msat: 1000,
    value_msat_total: 100000,
    action: 2,
    sender: 'listener',
    app: 'fountain',
    message: 'Boosting "ACID" by Horseheads',
    podcast: 'Homegrown Hits',
    episode: 'Episode 148',
    tlv: JSON.stringify({ name: 'MSP 2.0', sender_name: 'listener', guid: 'show-guid' }),
    ...overrides
  })!;
}

/** No blobs anywhere, and any derived read returns nothing. */
function emptyStore() {
  mockList.mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false });
}

describe('isBoostStoreConfigured', () => {
  beforeEach(() => { delete process.env.MSP_BOOST_NAMESPACE; });

  it('is false when unset', () => {
    expect(isBoostStoreConfigured()).toBe(false);
  });

  it('rejects a namespace short enough to brute force, or one with path characters', () => {
    process.env.MSP_BOOST_NAMESPACE = 'short';
    expect(isBoostStoreConfigured()).toBe(false);
    process.env.MSP_BOOST_NAMESPACE = '../../feeds/escape-attempt';
    expect(isBoostStoreConfigured()).toBe(false);
  });

  it('accepts a long opaque segment', () => {
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    expect(isBoostStoreConfigured()).toBe(true);
  });
});

describe('paths', () => {
  beforeEach(() => { process.env.MSP_BOOST_NAMESPACE = NAMESPACE; });

  it('puts the raw tree behind the namespace and keys on direction and index', () => {
    expect(rawPath(boost(10695))).toBe(`boosts/raw/${NAMESPACE}/2026-08/incoming-10695.json`);
  });

  it('buckets derived by ISO week, with no namespace since it holds nothing private', () => {
    expect(derivedPath('2026-W35')).toBe('boosts/derived/2026-W35.json');
  });
});

describe('storeBoosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    mockPut.mockResolvedValue({ url: 'https://blob.example/x' });
  });

  it('writes one raw blob per record and one derived blob per week', async () => {
    emptyStore();
    const result = await storeBoosts(
      [{ parsed: boost(1), payload: { index: 1 } }, { parsed: boost(2), payload: { index: 2 } }],
      'webhook'
    );

    expect(result).toMatchObject({ written: 2, duplicates: 0, weeks: ['2026-W35'] });
    const paths = mockPut.mock.calls.map(c => c[0]);
    expect(paths).toContain(`boosts/raw/${NAMESPACE}/2026-08/incoming-1.json`);
    expect(paths).toContain(`boosts/raw/${NAMESPACE}/2026-08/incoming-2.json`);
    expect(paths).toContain('boosts/derived/2026-W35.json');
  });

  it('skips a raw write whose blob is already listed, but still merges derived', async () => {
    // The dedup mechanism: index is unique per node, so the path already existing
    // means this exact boost was stored before.
    mockList.mockImplementation(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        blobs: prefix.startsWith('boosts/raw/')
          ? [{ pathname: `boosts/raw/${NAMESPACE}/2026-08/incoming-1.json`, url: 'https://blob.example/raw' }]
          : [],
        cursor: undefined,
        hasMore: false
      })
    );

    const result = await storeBoosts([{ parsed: boost(1), payload: { index: 1 } }], 'import');

    expect(result).toMatchObject({ written: 0, duplicates: 1 });
    // Re-running the import must still repair a lost derived write.
    expect(mockPut.mock.calls.map(c => c[0])).toEqual(['boosts/derived/2026-W35.json']);
  });

  it('treats a lost race on the raw write as a duplicate, not a failure', async () => {
    emptyStore();
    mockPut.mockImplementation((path: string) =>
      path.startsWith('boosts/raw/')
        ? Promise.reject(new Error('This blob already exists'))
        : Promise.resolve({ url: 'https://blob.example/x' })
    );

    const result = await storeBoosts([{ parsed: boost(1), payload: { index: 1 } }], 'webhook');
    expect(result).toMatchObject({ written: 0, duplicates: 1 });
  });

  it('propagates a genuine blob failure instead of silently dropping the boost', async () => {
    emptyStore();
    mockPut.mockRejectedValue(new Error('storage quota exceeded'));
    await expect(storeBoosts([{ parsed: boost(1), payload: { index: 1 } }], 'webhook'))
      .rejects.toThrow('storage quota exceeded');
  });

  it('stores the payload verbatim in raw and a PII-free projection in derived', async () => {
    emptyStore();
    const payload = { index: 1, sender: 'listener', message: 'Boosting "ACID" by Horseheads' };
    await storeBoosts([{ parsed: boost(1), payload }], 'webhook');

    const rawCall = mockPut.mock.calls.find(c => String(c[0]).startsWith('boosts/raw/'))!;
    const raw = JSON.parse(rawCall[1] as string);
    expect(raw.source).toBe('webhook');
    expect(raw.payload).toEqual(payload);

    const derivedCall = mockPut.mock.calls.find(c => String(c[0]).startsWith('boosts/derived/'))!;
    const derivedJson = derivedCall[1] as string;
    expect(derivedJson).not.toContain('listener');
    expect(derivedJson).not.toContain('Boosting');
    expect(JSON.parse(derivedJson)[0].trackTitle).toBe('ACID');
  });

  it('merges an existing week rather than replacing it, and lets the newer record win', async () => {
    mockList.mockImplementation(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        blobs: prefix.startsWith('boosts/derived/')
          ? [{ pathname: 'boosts/derived/2026-W35.json', url: 'https://blob.example/week' }]
          : [],
        cursor: undefined,
        hasMore: false
      })
    );
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify([
        { index: 1, ts: 1, trackTitle: 'STALE' },
        { index: 99, ts: 2, trackTitle: 'KEEP ME' }
      ]))
    });

    await storeBoosts([{ parsed: boost(1), payload: {} }], 'import');

    const derivedCall = mockPut.mock.calls.find(c => String(c[0]).startsWith('boosts/derived/'))!;
    const merged = JSON.parse(derivedCall[1] as string);
    expect(merged.map((r: { index: number }) => r.index).sort()).toEqual([1, 99]);
    expect(merged.find((r: { index: number }) => r.index === 1).trackTitle).toBe('ACID');
    expect(merged.find((r: { index: number }) => r.index === 99).trackTitle).toBe('KEEP ME');
  });

  it('busts the CDN on every read and never lets a mutable blob be cached', async () => {
    // cache: 'no-store' does NOT bypass a CDN — it governs the client's own HTTP cache,
    // and Node's fetch has none. Only a distinct URL forces the edge to re-fetch.
    mockList.mockImplementation(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        blobs: prefix.startsWith('boosts/derived/')
          ? [{ pathname: 'boosts/derived/2026-W35.json', url: 'https://blob.example/week' }]
          : [],
        cursor: undefined,
        hasMore: false
      })
    );
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('[]') });

    await storeBoosts([{ parsed: boost(1), payload: {} }], 'import');

    const readUrl = mockFetch.mock.calls[0][0] as string;
    expect(readUrl).toMatch(/^https:\/\/blob\.example\/week\?__fresh=\d+$/);
    for (const call of mockPut.mock.calls) {
      expect(call[2], String(call[0])).toMatchObject({ cacheControlMaxAge: 0 });
    }
  });

  it('refuses to overwrite a week whose existing records could not be read', async () => {
    // The failure that cost 2,527 records: a failed read was reported as an empty week,
    // so the caller merged its batch onto nothing and overwrote everything already there.
    mockList.mockImplementation(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        blobs: prefix.startsWith('boosts/derived/')
          ? [{ pathname: 'boosts/derived/2026-W35.json', url: 'https://blob.example/week' }]
          : [],
        cursor: undefined,
        hasMore: false
      })
    );
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });

    await expect(storeBoosts([{ parsed: boost(1), payload: {} }], 'import'))
      .rejects.toThrow(/Blob read failed: 500/);

    // Nothing may be written to that week on a failed read.
    expect(mockPut.mock.calls.filter(c => String(c[0]).startsWith('boosts/derived/'))).toHaveLength(0);
  });

  it('treats a 404 as a week that does not exist yet, which is safe to create', async () => {
    mockList.mockImplementation(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        blobs: prefix.startsWith('boosts/derived/')
          ? [{ pathname: 'boosts/derived/2026-W35.json', url: 'https://blob.example/week' }]
          : [],
        cursor: undefined,
        hasMore: false
      })
    );
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') });

    const result = await storeBoosts([{ parsed: boost(1), payload: {} }], 'import');
    expect(result.weekSizes).toEqual({ '2026-W35': 1 });
  });

  it('reports the stored size of every week it touched', async () => {
    // This is the check that would have caught the caching bug on the first batch:
    // send 2, see weekSizes say 1, and the loss is visible immediately.
    emptyStore();
    const result = await storeBoosts(
      [{ parsed: boost(1), payload: {} }, { parsed: boost(2), payload: {} }],
      'import'
    );
    expect(result.weekSizes).toEqual({ '2026-W35': 2 });
  });

  it('does nothing at all for an empty batch', async () => {
    emptyStore();
    expect(await storeBoosts([], 'webhook')).toEqual({ written: 0, duplicates: 0, weeks: [], weekSizes: {} });
    expect(mockPut).not.toHaveBeenCalled();
  });
});
