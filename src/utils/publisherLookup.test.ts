import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookupPublisherFeed, pickFeedForUrl, PUBLISHER_NOT_FOUND } from './publisherLookup';

const LABEL = { podcastGuid: 'label-guid', url: 'https://label.example.com/feed.xml', title: 'Label', image: 'https://label.example.com/a.jpg' };
const OTHER = { podcastGuid: 'other-guid', url: 'https://unrelated.example.com/rss', title: 'Unrelated' };

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status === 200, status, json: async () => body })));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickFeedForUrl', () => {
  it('takes the result whose URL is the one asked for, ignoring case and edge spaces', () => {
    expect(pickFeedForUrl([OTHER, LABEL], ' HTTPS://label.example.com/feed.xml ')).toBe(LABEL);
  });

  it('takes the single answer of an exact URL lookup, which may name the redirected address', () => {
    expect(pickFeedForUrl([{ ...LABEL, url: 'https://cdn.example.com/feed.xml' }], 'https://label.example.com/feed.xml'))
      .toEqual({ ...LABEL, url: 'https://cdn.example.com/feed.xml' });
  });

  it('never takes the first hit of a full-text search', () => {
    // pisearch sends a URL with no ".xml", "/feed" or "rss" to search/byterm.
    expect(pickFeedForUrl([OTHER], 'https://label.example.com/catalog.php')).toBeUndefined();
    expect(pickFeedForUrl([OTHER, LABEL], 'https://label.example.com/catalog.php')).toBeUndefined();
  });
});

describe('lookupPublisherFeed', () => {
  it('gives the GUID, title and image of the feed at the URL', async () => {
    respond(200, { feeds: [LABEL] });
    expect(await lookupPublisherFeed(LABEL.url)).toEqual({
      ok: true,
      feed: { feedGuid: 'label-guid', title: 'Label', image: 'https://label.example.com/a.jpg' }
    });
  });

  it('reports "not found" when no result is the feed at the URL', async () => {
    respond(200, { feeds: [OTHER] });
    expect(await lookupPublisherFeed('https://label.example.com/catalog.php')).toEqual({ ok: false, error: PUBLISHER_NOT_FOUND });
  });

  it("passes on the endpoint's error, and never throws on a network failure", async () => {
    respond(400, { error: 'Search failed' });
    expect(await lookupPublisherFeed(LABEL.url)).toEqual({ ok: false, error: 'Search failed' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await lookupPublisherFeed(LABEL.url)).toEqual({ ok: false, error: 'Failed to lookup feed' });
  });
});
