import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPut, mockList } = vi.hoisted(() => ({ mockPut: vi.fn(), mockList: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: mockPut, list: mockList }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  isBoostStoreConfigured,
  rawPath,
  derivedPath,
  storeRawBoosts,
  replaceDerivedWeek
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

describe('storeRawBoosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    mockPut.mockResolvedValue({ url: 'https://blob.example/x' });
  });

  it('writes one immutable blob per record', async () => {
    emptyStore();
    const result = await storeRawBoosts(
      [{ parsed: boost(1), payload: { index: 1 } }, { parsed: boost(2), payload: { index: 2 } }],
      'import'
    );

    expect(result).toEqual({ written: 2, duplicates: 0 });
    const paths = mockPut.mock.calls.map(c => c[0]).sort();
    expect(paths).toEqual([
      `boosts/raw/${NAMESPACE}/2026-08/incoming-1.json`,
      `boosts/raw/${NAMESPACE}/2026-08/incoming-2.json`
    ]);
    // Immutable: a raw record is never rewritten, which is what makes it safe to cache.
    for (const call of mockPut.mock.calls) expect(call[2]).toMatchObject({ allowOverwrite: false });
  });

  it('skips a record whose blob is already listed', async () => {
    mockList.mockResolvedValue({
      blobs: [{ pathname: `boosts/raw/${NAMESPACE}/2026-08/incoming-1.json`, url: 'https://blob.example/raw' }],
      cursor: undefined,
      hasMore: false
    });

    expect(await storeRawBoosts([{ parsed: boost(1), payload: {} }], 'import'))
      .toEqual({ written: 0, duplicates: 1 });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('treats a lost race on the write as a duplicate, not a failure', async () => {
    emptyStore();
    mockPut.mockRejectedValue(new Error('This blob already exists'));
    expect(await storeRawBoosts([{ parsed: boost(1), payload: {} }], 'webhook'))
      .toEqual({ written: 0, duplicates: 1 });
  });

  it('propagates a genuine blob failure instead of silently dropping the boost', async () => {
    emptyStore();
    mockPut.mockRejectedValue(new Error('storage quota exceeded'));
    await expect(storeRawBoosts([{ parsed: boost(1), payload: {} }], 'webhook'))
      .rejects.toThrow('storage quota exceeded');
  });

  it('stores the payload verbatim, listener fields included', async () => {
    emptyStore();
    const payload = { index: 1, sender: 'listener', message: 'Boosting "ACID" by Horseheads' };
    await storeRawBoosts([{ parsed: boost(1), payload }], 'webhook');

    const stored = JSON.parse(mockPut.mock.calls[0][1] as string);
    expect(stored.source).toBe('webhook');
    expect(stored.payload).toEqual(payload);
  });

  it('does nothing at all for an empty batch', async () => {
    emptyStore();
    expect(await storeRawBoosts([], 'webhook')).toEqual({ written: 0, duplicates: 0 });
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('replaceDerivedWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    mockPut.mockResolvedValue({ url: 'https://blob.example/x' });
  });

  it('NEVER reads anything before writing', async () => {
    // The entire point of this design. A Vercel Blob is served through a CDN that
    // caches on pathname with a 60-second floor and ignores query strings, so any
    // read-modify-write at import cadence merges onto a stale base and truncates the
    // week. Writing whole removes the read, and with it the bug.
    await replaceDerivedWeek('2026-W35', [boost(1), boost(2)]);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockPut).toHaveBeenCalledTimes(1);
  });

  it('writes the whole week and reports its size', async () => {
    const size = await replaceDerivedWeek('2026-W35', [boost(1), boost(2), boost(3)]);
    expect(size).toBe(3);
    expect(mockPut.mock.calls[0][0]).toBe('boosts/derived/2026-W35.json');
    expect(mockPut.mock.calls[0][2]).toMatchObject({ allowOverwrite: true });
    expect(JSON.parse(mockPut.mock.calls[0][1] as string)).toHaveLength(3);
  });

  it('drops records that do not belong to the stated week', async () => {
    const otherWeek = boost(9, { time: Math.floor(Date.UTC(2026, 0, 8) / 1000) });
    const size = await replaceDerivedWeek('2026-W35', [boost(1), otherWeek]);
    expect(size).toBe(1);
  });

  it('deduplicates on index, so a repeated record cannot inflate a chart', async () => {
    const size = await replaceDerivedWeek('2026-W35', [boost(1), boost(1), boost(2)]);
    expect(size).toBe(2);
  });

  it('writes an empty week rather than failing, so a week can be emptied deliberately', async () => {
    expect(await replaceDerivedWeek('2026-W35', [])).toBe(0);
    expect(JSON.parse(mockPut.mock.calls[0][1] as string)).toEqual([]);
  });

  it('carries no listener field into the derived file', async () => {
    await replaceDerivedWeek('2026-W35', [boost(1)]);
    const written = mockPut.mock.calls[0][1] as string;
    expect(written).not.toContain('listener');
    expect(written).not.toContain('Boosting');
    expect(JSON.parse(written)[0].trackTitle).toBe('ACID');
  });
});
