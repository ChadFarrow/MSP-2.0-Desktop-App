import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockLookup = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }));

import { safeFetchFollow, readCapped, looksLikeFeedText } from './safeFetch.js';

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const START = 'https://example.com/feed.xml';
const METADATA = 'http://169.254.169.254/latest/meta-data/';

/** Per-URL factories — a Response-alike's reader is single-use. */
function serve(map: Record<string, () => unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    const make = map[url];
    if (!make) throw new Error(`unexpected fetch: ${url}`);
    return make();
  });
}

function bodyResponse(body: string, init: { status?: number; chunkSize?: number } = {}) {
  const bytes = new TextEncoder().encode(body);
  const chunkSize = init.chunkSize ?? bytes.byteLength;
  let offset = 0;
  const cancel = vi.fn(async () => {});
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.byteLength) return { done: true, value: undefined };
          const chunk = bytes.slice(offset, offset + chunkSize);
          offset += chunk.byteLength;
          return { done: false, value: chunk };
        },
        cancel
      })
    },
    text: async () => body,
    cancel
  };
}

function redirect(status: number, location: string | null) {
  return {
    ok: false,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === 'location' ? location : null) },
    body: null,
    text: async () => ''
  };
}

const opts = (over: Record<string, unknown> = {}) => ({
  signal: new AbortController().signal,
  headers: { 'User-Agent': 'test' },
  ...over
});

describe('safeFetchFollow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue(PUBLIC_V4);
  });

  it('checks hop 0 by default', async () => {
    serve({ [START]: () => bodyResponse('<rss/>') });
    await safeFetchFollow(START, opts());
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('skips the hop-0 check when the caller already ran it', async () => {
    // probeFeedUrl runs one preflight for both of its parallel walks, so they
    // must not each repeat the DNS lookup.
    serve({ [START]: () => bodyResponse('<rss/>') });
    await safeFetchFollow(START, opts({ startAlreadyChecked: true }));
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('refuses an unsafe first hop', async () => {
    const result = await safeFetchFollow(METADATA, opts());
    expect(result).toMatchObject({ ok: false, kind: 'unsafe', hop: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-checks each redirect hop and never fetches a blocked target', async () => {
    // The whole reason redirects are walked by hand: `redirect: "follow"` would
    // let a public URL bounce into link-local space behind our back.
    serve({
      [START]: () => redirect(302, METADATA),
      [METADATA]: () => bodyResponse('secrets')
    });
    const result = await safeFetchFollow(START, opts({ startAlreadyChecked: true }));

    expect(result).toMatchObject({ ok: false, kind: 'unsafe', hop: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(START);
  });

  it('follows a safe redirect and reports the final URL', async () => {
    const target = 'https://example.com/real-feed.xml';
    serve({ [START]: () => redirect(301, target), [target]: () => bodyResponse('<rss/>') });
    const result = await safeFetchFollow(START, opts());

    expect(result.ok).toBe(true);
    expect(result.ok && result.finalUrl).toBe(target);
  });

  it('resolves a relative Location against the current URL', async () => {
    const target = 'https://example.com/moved.xml';
    serve({ [START]: () => redirect(302, '/moved.xml'), [target]: () => bodyResponse('<rss/>') });
    const result = await safeFetchFollow(START, opts());
    expect(result.ok && result.finalUrl).toBe(target);
  });

  it('reports a redirect with no destination', async () => {
    serve({ [START]: () => redirect(302, null) });
    const result = await safeFetchFollow(START, opts());
    expect(result).toMatchObject({ ok: false, kind: 'no-location', status: 302 });
  });

  it('gives up after 5 redirects', async () => {
    const url = (n: number) => `https://example.com/${n}`;
    const map: Record<string, () => unknown> = {};
    for (let i = 0; i <= 10; i++) map[url(i)] = () => redirect(302, url(i + 1));
    serve(map);

    const result = await safeFetchFollow(url(0), opts());
    expect(result).toMatchObject({ ok: false, kind: 'too-many-redirects' });
    expect(mockFetch).toHaveBeenCalledTimes(6); // hops 0..5
  });

  it('returns ok:true for a non-2xx — that classification is the caller\'s policy', async () => {
    serve({ [START]: () => bodyResponse('', { status: 503 }) });
    const result = await safeFetchFollow(START, opts());

    expect(result.ok).toBe(true);
    expect(result.ok && result.response.status).toBe(503);
  });
});

describe('readCapped', () => {
  it('returns a short body untruncated', async () => {
    const { text, truncated } = await readCapped(bodyResponse('hello') as never, 1024);
    expect(text).toBe('hello');
    expect(truncated).toBe(false);
  });

  it('does not flag a body of exactly maxBytes', async () => {
    const body = 'x'.repeat(64);
    const { text, truncated } = await readCapped(bodyResponse(body, { chunkSize: 16 }) as never, 64);
    expect(text).toBe(body);
    expect(truncated).toBe(false);
  });

  it('flags and trims a body past maxBytes', async () => {
    const { text, truncated } = await readCapped(
      bodyResponse('x'.repeat(200), { chunkSize: 16 }) as never,
      64
    );
    expect(text).toHaveLength(64);
    expect(truncated).toBe(true);
  });

  it('cancels the reader instead of draining the rest of the transfer', async () => {
    const response = bodyResponse('x'.repeat(4096), { chunkSize: 16 });
    await readCapped(response as never, 32);
    expect(response.cancel).toHaveBeenCalled();
  });

  it('falls back to text() when the response has no body stream', async () => {
    const response = { body: null, text: async () => 'plain' };
    const { text, truncated } = await readCapped(response as never, 1024);
    expect(text).toBe('plain');
    expect(truncated).toBe(false);
  });
});

describe('looksLikeFeedText', () => {
  it('recognises RSS, Atom and a bare channel', () => {
    expect(looksLikeFeedText('<?xml?><rss version="2.0">')).toBe(true);
    expect(looksLikeFeedText('<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(looksLikeFeedText('<channel>')).toBe(true);
  });

  it('rejects an HTML page', () => {
    expect(looksLikeFeedText('<!doctype html><html><body>hi</body></html>')).toBe(false);
  });
});
