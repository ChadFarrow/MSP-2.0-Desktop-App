import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PLATFORM_HOSTS,
  getPlatformHost,
  classifyLinkBack,
  classifyAlbumLinkBack,
  checkAlbumLinkBack,
  fetchCatalogFeedXml,
  platformRefusal,
  platformWarning,
  linkBackMessage
} from './publisherControl';
import type { RemoteItem } from '../types/feed';

// Real values from feeds checked on 2026-10-18 (see the design doc).
const LONGY_PUBLISHER = '4d25f0dd-9270-4fb7-8aeb-ddd4a5213585';
const NATHAN_PUBLISHER = 'c0d95236-3400-43e6-9721-d3904f182767';
const WAVLAKE_ARTIST_URL = `https://wavlake.com/feed/artist/${LONGY_PUBLISHER}`;
const NMNU_PUBLISHER_URL = 'https://headstarts.uk/msp/publisher-feeds/longy-everything-publisher-feed.xml';

const album = (publisherXml: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Album</title>
    <description>d</description>
    <podcast:medium>music</podcast:medium>
    ${publisherXml}
  </channel>
</rss>`;

const nested = (feedGuid: string, feedUrl = NMNU_PUBLISHER_URL) =>
  `<podcast:publisher><podcast:remoteItem medium="publisher" feedGuid="${feedGuid}" feedUrl="${feedUrl}"/></podcast:publisher>`;

const item = (feedUrl?: string): RemoteItem => ({ feedGuid: 'g', feedUrl, medium: 'music' });

describe('getPlatformHost', () => {
  it.each([
    ['https://wavlake.com/feed/music/a82acc2f-3440-491c-94c2-d27bebf6cfe6', 'Wavlake'],
    ['https://www.wavlake.com/feed/36639728-9454-40d9-8354-c91bc9939f1e', 'Wavlake'],
    ['https://WWW.Wavlake.com:443/feed/x', 'Wavlake'],
    ['https://feeds.fountain.fm/WmsWR5Ohttd6cuxfRdHt', 'Fountain'],
  ])('matches %s', (url, name) => {
    expect(getPlatformHost(url)?.name).toBe(name);
  });

  it.each([
    'https://notwavlake.com/feed.xml',
    'https://wavlake.com.evil.example/feed.xml',
    'https://musicsideproject.com/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml',
    'https://headstarts.uk/msp/longy/Lady/Lady-You-Shot-Me.xml',
    '',
    'not a url',
    undefined,
  ])('does not match %s', (url) => {
    expect(getPlatformHost(url)).toBeNull();
  });

  it('handles a URL with spaces', () => {
    expect(getPlatformHost('https://headstarts.uk/msp/fable music/the raven/the raven.xml')).toBeNull();
  });
});

describe('classifyLinkBack', () => {
  it('is linked when the GUID matches', () => {
    expect(classifyLinkBack(album(nested(LONGY_PUBLISHER)), LONGY_PUBLISHER)).toEqual({ status: 'linked' });
  });

  it('ignores case and whitespace in the GUID', () => {
    expect(classifyLinkBack(album(nested(` ${LONGY_PUBLISHER.toUpperCase()} `)), LONGY_PUBLISHER))
      .toEqual({ status: 'linked' });
  });

  it('is linked through a wavlake.com/feed/artist URL (the URL is not compared)', () => {
    expect(classifyLinkBack(album(nested(LONGY_PUBLISHER, WAVLAKE_ARTIST_URL)), LONGY_PUBLISHER))
      .toEqual({ status: 'linked' });
  });

  it('reports another publisher', () => {
    const url = 'https://headstarts.uk/msp/publisher-feeds/nathan-abbott-everything.xml';
    expect(classifyLinkBack(album(nested(NATHAN_PUBLISHER, url)), LONGY_PUBLISHER))
      .toEqual({ status: 'other', publisherGuid: NATHAN_PUBLISHER, publisherUrl: url });
  });

  it('is linked when this publisher is a later party (podcast-namespace PR #793)', () => {
    const two = '<podcast:publisher>' +
      `<podcast:remoteItem medium="publisher" rel="artist" feedGuid="${NATHAN_PUBLISHER}"/>` +
      `<podcast:remoteItem medium="publisher" rel="label" feedGuid="${LONGY_PUBLISHER}"/>` +
      '</podcast:publisher>';
    expect(classifyLinkBack(album(two), LONGY_PUBLISHER)).toEqual({ status: 'linked' });
    expect(classifyLinkBack(album(two), NATHAN_PUBLISHER)).toEqual({ status: 'linked' });
  });

  it('reports the first publisher named by GUID when none is this one', () => {
    const urlOnly = 'https://example.com/old-address.xml';
    const two = '<podcast:publisher>' +
      `<podcast:remoteItem medium="publisher" feedUrl="${urlOnly}"/>` +
      `<podcast:remoteItem medium="publisher" feedGuid="${NATHAN_PUBLISHER}"/>` +
      '</podcast:publisher>';
    expect(classifyLinkBack(album(two), LONGY_PUBLISHER)).toEqual({ status: 'other', publisherGuid: NATHAN_PUBLISHER });
  });

  it('reports no publisher tag', () => {
    expect(classifyLinkBack(album(''), LONGY_PUBLISHER)).toEqual({ status: 'none' });
  });

  it('reads the attribute form', () => {
    const tag = `<podcast:publisher medium="publisher" feedGuid="${LONGY_PUBLISHER}" feedUrl="${NMNU_PUBLISHER_URL}"/>`;
    expect(classifyLinkBack(album(tag), LONGY_PUBLISHER)).toEqual({ status: 'linked' });
  });

  it('never links on an empty GUID', () => {
    expect(classifyLinkBack(album(nested('')), '')).not.toEqual({ status: 'linked' });
  });

  it('reports unreadable XML as unknown', () => {
    expect(classifyLinkBack('<html><body>Not found</body></html>', LONGY_PUBLISHER)).toEqual({ status: 'unknown' });
  });
});

describe('classifyAlbumLinkBack', () => {
  // What Download Catalog checks on the album it has already parsed.
  it('is other for an album that names only another publisher, and linked when this one is a later party', () => {
    const nathan = { feedGuid: NATHAN_PUBLISHER, feedUrl: 'https://example.com/nathan.xml' };
    expect(classifyAlbumLinkBack({ publisher: nathan }, LONGY_PUBLISHER)).toEqual({
      status: 'other',
      publisherGuid: NATHAN_PUBLISHER,
      publisherUrl: 'https://example.com/nathan.xml'
    });
    expect(classifyAlbumLinkBack(
      { publisher: nathan, additionalPublishers: [{ feedGuid: LONGY_PUBLISHER }] },
      LONGY_PUBLISHER
    )).toEqual({ status: 'linked' });
    expect(classifyAlbumLinkBack({}, LONGY_PUBLISHER)).toEqual({ status: 'none' });
  });
});

describe('linkBackMessage with the beta multi-publisher feature', () => {
  const other = { status: 'other' as const, publisherGuid: NATHAN_PUBLISHER };

  it('says MSP leaves the album alone without it', () => {
    expect(linkBackMessage(other, true)).toContain('MSP leaves it alone');
  });

  it('says publish adds this publisher, or that the new version names both', () => {
    expect(linkBackMessage(other, true, true)).toContain('adds this publisher as another publisher');
    expect(linkBackMessage(other, false, true)).toContain('names both publishers');
  });
});

describe('checkAlbumLinkBack', () => {
  it('never fetches a row with no URL', async () => {
    const fetchXml = vi.fn();
    expect(await checkAlbumLinkBack(item(undefined), LONGY_PUBLISHER, fetchXml)).toEqual({ status: 'unknown' });
    expect(fetchXml).not.toHaveBeenCalled();
  });

  it('never fetches a platform row', async () => {
    const fetchXml = vi.fn();
    await checkAlbumLinkBack(item('https://wavlake.com/feed/music/4403575a-c0b8-48df-8738-285ee6c826d7'), LONGY_PUBLISHER, fetchXml);
    expect(fetchXml).not.toHaveBeenCalled();
  });

  it('classifies what it fetched', async () => {
    const fetchXml = vi.fn().mockResolvedValue(album(nested(LONGY_PUBLISHER)));
    const url = 'https://headstarts.uk/msp/longy/Lady/Lady-You-Shot-Me.xml';
    expect(await checkAlbumLinkBack(item(url), LONGY_PUBLISHER, fetchXml)).toEqual({ status: 'linked' });
    expect(fetchXml).toHaveBeenCalledWith(url);
  });

  it('reports a failed fetch as unknown', async () => {
    const fetchXml = vi.fn().mockRejectedValue(new Error('Feed not found'));
    expect(await checkAlbumLinkBack(item('https://headstarts.uk/x.xml'), LONGY_PUBLISHER, fetchXml))
      .toEqual({ status: 'unknown' });
  });
});

describe('fetchCatalogFeedXml', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the same-origin hosted path for an MSP URL', async () => {
    // The canonical URL would go through the rate-limited /api/proxy-feed.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => album('') });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCatalogFeedXml('https://new.musicsideproject.com/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml');
  });

  it('bypasses the browser cache', async () => {
    // /api/hosted/{id}.xml is served `public, max-age=300`, and the editor reads
    // every MSP album on open — so without this, a publish within five minutes
    // regenerated an album from the pre-edit copy and the post-publish check
    // reported the old status.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => album('') });
    vi.stubGlobal('fetch', fetchMock);
    await fetchCatalogFeedXml('https://musicsideproject.com/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml');
    expect(fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });

  it('throws when the hosted feed is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }));
    await expect(fetchCatalogFeedXml('https://musicsideproject.com/api/hosted/abc.xml')).rejects.toThrow();
  });
});

describe('copy', () => {
  it('tells the artist to keep the GUID and remove the platform copy', () => {
    const wavlake = PLATFORM_HOSTS[0];
    for (const text of [platformRefusal(wavlake), platformWarning(wavlake)]) {
      expect(text).toContain('keeps its GUID');
      expect(text).toContain('remove the Wavlake copy, or ask Wavlake to remove it');
      expect(text).not.toMatch(/template/i);
    }
  });

  it('never asks for an upload when another publisher has the album', () => {
    expect(linkBackMessage({ status: 'other', publisherGuid: NATHAN_PUBLISHER }, false)).not.toMatch(/upload/i);
  });

  it('points a self-hosted album to Download Catalog and an MSP album to publishing', () => {
    expect(linkBackMessage({ status: 'none' }, false)).toContain('Download Catalog');
    expect(linkBackMessage({ status: 'none' }, true)).toContain('when you publish');
  });
});
