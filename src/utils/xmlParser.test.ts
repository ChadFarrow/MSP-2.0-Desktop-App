import { describe, it, expect, vi } from 'vitest';
import { parseRssFeed, parsePublisherRssFeed, isVideoFeed, isPublisherFeed } from './xmlParser';

// Mock apiFetch (used by fetchFeedFromUrl, not by parsers directly, but imported)
vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}));

/** Wrap channel content in a minimal RSS skeleton */
function makeChannelXml(channelContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    ${channelContent}
  </channel>
</rss>`;
}

/** Wrap channel + items in RSS skeleton */
function makeFeedXml(channelContent: string, items: string = ''): string {
  return makeChannelXml(`${channelContent}${items}`);
}

describe('parseRssFeed', () => {
  describe('basic feed parsing', () => {
    it('parses required fields', () => {
      const xml = makeChannelXml(`
        <title>My Album</title>
        <itunes:author>Test Artist</itunes:author>
        <description>A test album</description>
        <language>en</language>
        <podcast:guid>abc-123</podcast:guid>
        <podcast:medium>music</podcast:medium>
      `);
      const album = parseRssFeed(xml);
      expect(album.title).toBe('My Album');
      expect(album.author).toBe('Test Artist');
      expect(album.description).toBe('A test album');
      expect(album.language).toBe('en');
      expect(album.podcastGuid).toBe('abc-123');
      expect(album.medium).toBe('music');
    });

    it('defaults medium to music when not specified', () => {
      const xml = makeChannelXml('<title>Test</title>');
      const album = parseRssFeed(xml);
      expect(album.medium).toBe('music');
    });

    it('throws on invalid RSS (missing channel)', () => {
      expect(() => parseRssFeed('<rss></rss>')).toThrow('Invalid RSS feed');
    });

    it('parses generator and dates', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <generator>TestGen</generator>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        <lastBuildDate>Tue, 02 Jan 2024 00:00:00 GMT</lastBuildDate>
      `);
      const album = parseRssFeed(xml);
      expect(album.generator).toBe('TestGen');
      expect(album.pubDate).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    });

    it('parses link field', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <link>https://example.com</link>
      `);
      const album = parseRssFeed(xml);
      expect(album.link).toBe('https://example.com');
    });

    it('parses locked element', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:locked owner="me@test.com">yes</podcast:locked>
      `);
      const album = parseRssFeed(xml);
      expect(album.locked).toBe(true);
      expect(album.lockedOwner).toBe('me@test.com');
    });

    it('parses explicit as boolean', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <itunes:explicit>true</itunes:explicit>
      `);
      const album = parseRssFeed(xml);
      expect(album.explicit).toBe(true);
    });

    it('parses owner name and email', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <itunes:owner>
          <itunes:name>Owner Name</itunes:name>
          <itunes:email>owner@test.com</itunes:email>
        </itunes:owner>
      `);
      const album = parseRssFeed(xml);
      expect(album.ownerName).toBe('Owner Name');
      expect(album.ownerEmail).toBe('owner@test.com');
    });

    it('parses keywords', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <itunes:keywords>rock, indie, guitar</itunes:keywords>
      `);
      const album = parseRssFeed(xml);
      expect(album.keywords).toBe('rock, indie, guitar');
    });
  });

  describe('image handling', () => {
    it('parses image element', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <image>
          <url>https://example.com/art.jpg</url>
          <title>Album Art</title>
          <link>https://example.com</link>
          <description>Cover art</description>
        </image>
      `);
      const album = parseRssFeed(xml);
      expect(album.imageUrl).toBe('https://example.com/art.jpg');
      expect(album.imageTitle).toBe('Album Art');
      expect(album.imageDescription).toBe('Cover art');
    });

    it('falls back to itunes:image when image element is missing', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <itunes:image href="https://example.com/itunes-art.jpg" />
      `);
      const album = parseRssFeed(xml);
      expect(album.imageUrl).toBe('https://example.com/itunes-art.jpg');
    });

    it('prefers image element over itunes:image', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <image>
          <url>https://example.com/main.jpg</url>
        </image>
        <itunes:image href="https://example.com/itunes.jpg" />
      `);
      const album = parseRssFeed(xml);
      expect(album.imageUrl).toBe('https://example.com/main.jpg');
    });
  });

  describe('person parsing', () => {
    it('parses a single person', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:person group="music" role="vocalist" href="https://artist.com" img="https://artist.com/photo.jpg">Alice</podcast:person>
      `);
      const album = parseRssFeed(xml);
      expect(album.persons).toHaveLength(1);
      expect(album.persons[0].name).toBe('Alice');
      expect(album.persons[0].href).toBe('https://artist.com');
      expect(album.persons[0].img).toBe('https://artist.com/photo.jpg');
      expect(album.persons[0].roles[0]).toEqual({ group: 'music', role: 'vocalist' });
    });

    it('merges multiple tags for the same person into multiple roles', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:person group="music" role="vocalist" href="https://bob.com" img="https://bob.com/photo.jpg">Bob</podcast:person>
        <podcast:person group="writing" role="songwriter" href="https://bob.com" img="https://bob.com/photo.jpg">Bob</podcast:person>
      `);
      const album = parseRssFeed(xml);
      expect(album.persons).toHaveLength(1);
      expect(album.persons[0].name).toBe('Bob');
      expect(album.persons[0].roles).toHaveLength(2);
    });

    it('deduplicates identical roles on same person', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:person group="music" role="vocalist">Alice</podcast:person>
        <podcast:person group="music" role="vocalist">Alice</podcast:person>
      `);
      const album = parseRssFeed(xml);
      expect(album.persons).toHaveLength(1);
      expect(album.persons[0].roles).toHaveLength(1);
    });

    it('defaults group to music and role to band', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:person>Artist</podcast:person>
      `);
      const album = parseRssFeed(xml);
      expect(album.persons[0].roles[0]).toEqual({ group: 'music', role: 'band' });
    });
  });

  describe('value block parsing', () => {
    it('parses value block with recipients', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:value type="lightning" method="keysend" suggested="0.00001">
          <podcast:valueRecipient name="Artist" address="abc123" type="node" split="90" />
          <podcast:valueRecipient name="App" address="app@ln.com" type="lnaddress" split="10" />
        </podcast:value>
      `);
      const album = parseRssFeed(xml);
      expect(album.value.recipients).toHaveLength(2);
      expect(album.value.recipients[0].name).toBe('Artist');
      expect(album.value.recipients[0].address).toBe('abc123');
      expect(album.value.recipients[0].type).toBe('node');
      expect(album.value.recipients[0].split).toBe(90);
      expect(album.value.recipients[1].type).toBe('lnaddress');
    });

    it('provides default value block when not present', () => {
      const xml = makeChannelXml('<title>Test</title>');
      const album = parseRssFeed(xml);
      expect(album.value).toBeDefined();
      expect(album.value.type).toBe('lightning');
      expect(album.value.method).toBe('keysend');
    });

    it('parses suggested amount', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:value type="lightning" method="keysend" suggested="0.000033333">
          <podcast:valueRecipient name="A" address="a" type="node" split="100" />
        </podcast:value>
      `);
      const album = parseRssFeed(xml);
      expect(album.value.suggested).toBe('0.000033333');
    });

    it('parses customKey and customValue on recipients', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:value type="lightning" method="keysend">
          <podcast:valueRecipient name="A" address="abc" type="node" split="100" customKey="7629169" customValue="podcast123" />
        </podcast:value>
      `);
      const album = parseRssFeed(xml);
      expect(album.value.recipients[0].customKey).toBe('7629169');
      expect(album.value.recipients[0].customValue).toBe('podcast123');
    });
  });

  describe('track parsing', () => {
    it('parses a basic track', () => {
      const xml = makeFeedXml(
        '<title>Album</title><podcast:medium>music</podcast:medium>',
        `<item>
          <title>Track One</title>
          <description>First track</description>
          <enclosure url="https://example.com/track1.mp3" length="1234567" type="audio/mpeg" />
          <itunes:duration>00:03:45</itunes:duration>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks).toHaveLength(1);
      expect(album.tracks[0].title).toBe('Track One');
      expect(album.tracks[0].description).toBe('First track');
      expect(album.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
      expect(album.tracks[0].enclosureLength).toBe('1234567');
      expect(album.tracks[0].enclosureType).toBe('audio/mpeg');
      expect(album.tracks[0].duration).toBe('00:03:45');
      expect(album.tracks[0].trackNumber).toBe(1);
    });

    it('parses episode number and uses it as trackNumber', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item>
          <title>Track</title>
          <podcast:episode>5</podcast:episode>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].episode).toBe(5);
      expect(album.tracks[0].trackNumber).toBe(5);
    });

    it('parses season number', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item>
          <title>Track</title>
          <podcast:season>2</podcast:season>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].season).toBe(2);
    });

    it('parses track explicit flag', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item>
          <title>Track</title>
          <itunes:explicit>true</itunes:explicit>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].explicit).toBe(true);
    });

    it('parses track art from itunes:image', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item>
          <title>Track</title>
          <itunes:image href="https://example.com/track-art.jpg" />
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].trackArtUrl).toBe('https://example.com/track-art.jpg');
    });

    it('parses transcript', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item>
          <title>Track</title>
          <podcast:transcript url="https://example.com/lyrics.srt" type="application/srt" />
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].transcriptUrl).toBe('https://example.com/lyrics.srt');
      expect(album.tracks[0].transcriptType).toBe('application/srt');
    });

    it('parses multiple tracks with correct numbering', () => {
      const xml = makeFeedXml(
        '<title>Album</title>',
        `<item><title>First</title></item>
         <item><title>Second</title></item>
         <item><title>Third</title></item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks).toHaveLength(3);
      expect(album.tracks[0].trackNumber).toBe(1);
      expect(album.tracks[1].trackNumber).toBe(2);
      expect(album.tracks[2].trackNumber).toBe(3);
    });

    it('parses per-track value block', () => {
      const xml = makeFeedXml(
        `<title>Album</title>
         <podcast:value type="lightning" method="keysend">
           <podcast:valueRecipient name="Album Artist" address="album@ln.com" type="lnaddress" split="100" />
         </podcast:value>`,
        `<item>
          <title>Track</title>
          <podcast:value type="lightning" method="keysend">
            <podcast:valueRecipient name="Featured" address="feat@ln.com" type="lnaddress" split="50" />
            <podcast:valueRecipient name="Album Artist" address="album@ln.com" type="lnaddress" split="50" />
          </podcast:value>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].value).toBeDefined();
      expect(album.tracks[0].value?.recipients).toHaveLength(2);
      expect(album.tracks[0].overrideValue).toBe(true);
    });

    it('sets overrideValue to false when track value matches album value', () => {
      const xml = makeFeedXml(
        `<title>Album</title>
         <podcast:value type="lightning" method="keysend">
           <podcast:valueRecipient name="Artist" address="artist@ln.com" type="lnaddress" split="100" />
         </podcast:value>`,
        `<item>
          <title>Track</title>
          <podcast:value type="lightning" method="keysend">
            <podcast:valueRecipient name="Artist" address="artist@ln.com" type="lnaddress" split="100" />
          </podcast:value>
        </item>`
      );
      const album = parseRssFeed(xml);
      expect(album.tracks[0].overrideValue).toBe(false);
    });
  });

  describe('artist npub', () => {
    it('parses artist npub from podcast:txt', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:txt purpose="npub">npub1abc123def456</podcast:txt>
      `);
      const album = parseRssFeed(xml);
      expect(album.artistNpub).toBe('npub1abc123def456');
    });

    it('ignores podcast:txt with non-npub purpose', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:txt purpose="verify">some-verification</podcast:txt>
      `);
      const album = parseRssFeed(xml);
      expect(album.artistNpub).toBeUndefined();
    });
  });

  describe('unknown element preservation', () => {
    it('captures unknown channel elements', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <custom:element>custom value</custom:element>
      `);
      const album = parseRssFeed(xml);
      expect(album.unknownChannelElements).toBeDefined();
      expect(album.unknownChannelElements?.['custom:element']).toBe('custom value');
    });

    it('does not capture known elements as unknown', () => {
      const xml = makeChannelXml(`
        <title>Known Title</title>
        <description>Known Description</description>
      `);
      const album = parseRssFeed(xml);
      // unknownChannelElements should not contain title or description
      expect(album.unknownChannelElements?.['title']).toBeUndefined();
      expect(album.unknownChannelElements?.['description']).toBeUndefined();
    });
  });

  describe('funding parsing', () => {
    it('parses single funding tag', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:funding url="https://donate.example.com">Support Us</podcast:funding>
      `);
      const album = parseRssFeed(xml);
      expect(album.funding).toHaveLength(1);
      expect(album.funding[0].url).toBe('https://donate.example.com');
      expect(album.funding[0].text).toBe('Support Us');
    });

    it('parses multiple funding tags', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:funding url="https://a.com">A</podcast:funding>
        <podcast:funding url="https://b.com">B</podcast:funding>
      `);
      const album = parseRssFeed(xml);
      expect(album.funding).toHaveLength(2);
    });
  });

  describe('publisher reference', () => {
    it('parses publisher reference', () => {
      const xml = makeChannelXml(`
        <title>Test</title>
        <podcast:publisher>
          <podcast:remoteItem feedGuid="pub-guid-123" feedUrl="https://example.com/publisher.xml" />
        </podcast:publisher>
      `);
      const album = parseRssFeed(xml);
      expect(album.publisher).toBeDefined();
      expect(album.publisher?.feedGuid).toBe('pub-guid-123');
      expect(album.publisher?.feedUrl).toBe('https://example.com/publisher.xml');
    });
  });
});

describe('parsePublisherRssFeed', () => {
  it('parses a publisher feed', () => {
    const xml = makeChannelXml(`
      <title>My Label</title>
      <itunes:author>Label Inc</itunes:author>
      <description>A music label</description>
      <podcast:guid>pub-guid</podcast:guid>
      <podcast:medium>publisher</podcast:medium>
    `);
    const feed = parsePublisherRssFeed(xml);
    expect(feed.title).toBe('My Label');
    expect(feed.author).toBe('Label Inc');
    expect(feed.medium).toBe('publisher');
    expect(feed.podcastGuid).toBe('pub-guid');
  });

  it('parses remote items', () => {
    const xml = makeChannelXml(`
      <title>Label</title>
      <podcast:medium>publisher</podcast:medium>
      <podcast:remoteItem feedGuid="album-1" feedUrl="https://example.com/album1.xml" medium="music">Album One</podcast:remoteItem>
      <podcast:remoteItem feedGuid="album-2" medium="music">Album Two</podcast:remoteItem>
    `);
    const feed = parsePublisherRssFeed(xml);
    expect(feed.remoteItems).toHaveLength(2);
    expect(feed.remoteItems[0].feedGuid).toBe('album-1');
    expect(feed.remoteItems[0].feedUrl).toBe('https://example.com/album1.xml');
    expect(feed.remoteItems[0].title).toBe('Album One');
    expect(feed.remoteItems[1].feedGuid).toBe('album-2');
    expect(feed.remoteItems[1].title).toBe('Album Two');
  });

  it('throws on invalid RSS', () => {
    expect(() => parsePublisherRssFeed('<rss></rss>')).toThrow('Invalid RSS feed');
  });
});

describe('feed type detection', () => {
  it('isVideoFeed detects video medium', () => {
    const xml = makeChannelXml('<title>Test</title><podcast:medium>video</podcast:medium>');
    expect(isVideoFeed(xml)).toBe(true);
  });

  it('isVideoFeed returns false for music', () => {
    const xml = makeChannelXml('<title>Test</title><podcast:medium>music</podcast:medium>');
    expect(isVideoFeed(xml)).toBe(false);
  });

  it('isVideoFeed returns false for invalid XML', () => {
    expect(isVideoFeed('not xml')).toBe(false);
  });

  it('isPublisherFeed detects publisher medium', () => {
    const xml = makeChannelXml('<title>Test</title><podcast:medium>publisher</podcast:medium>');
    expect(isPublisherFeed(xml)).toBe(true);
  });

  it('isPublisherFeed returns false for music', () => {
    const xml = makeChannelXml('<title>Test</title><podcast:medium>music</podcast:medium>');
    expect(isPublisherFeed(xml)).toBe(false);
  });

  it('isPublisherFeed returns false for invalid XML', () => {
    expect(isPublisherFeed('not xml at all')).toBe(false);
  });
});

// Helper to build RSS XML with raw channel-level podcast:person tags
function buildRssWithPersonTags(personTags: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Test Feed</title>
    <itunes:author>Test Artist</itunes:author>
    <description>A test feed</description>
    <language>en</language>
    <podcast:medium>music</podcast:medium>
    ${personTags}
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="https://example.com/track1.mp3" length="1234" type="audio/mpeg"/>
      <itunes:duration>03:45</itunes:duration>
    </item>
  </channel>
</rss>`;
}

describe('Person tag merging with npub', () => {
  const npubA = 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const npubB = 'npub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('keeps same-name persons with different npubs as distinct entries', () => {
    const tags = `
      <podcast:person href="https://example.com" img="https://example.com/p.jpg" npub="${npubA}" group="music" role="vocalist">Alex</podcast:person>
      <podcast:person href="https://example.com" img="https://example.com/p.jpg" npub="${npubB}" group="music" role="vocalist">Alex</podcast:person>
    `;
    const album = parseRssFeed(buildRssWithPersonTags(tags));

    expect(album.persons).toHaveLength(2);
    const npubs = album.persons.map(p => p.npub).sort();
    expect(npubs).toEqual([npubA, npubB].sort());
  });

  it('merges same-name + same-npub tags with different roles into one person', () => {
    const tags = `
      <podcast:person npub="${npubA}" group="music" role="vocalist">Alex</podcast:person>
      <podcast:person npub="${npubA}" group="music" role="guitarist">Alex</podcast:person>
    `;
    const album = parseRssFeed(buildRssWithPersonTags(tags));

    expect(album.persons).toHaveLength(1);
    expect(album.persons[0].npub).toBe(npubA);
    expect(album.persons[0].roles).toHaveLength(2);
    expect(album.persons[0].roles.map(r => r.role).sort()).toEqual(['guitarist', 'vocalist']);
  });

  it('leaves npub undefined when attribute is absent', () => {
    const tags = `
      <podcast:person group="music" role="vocalist">Alex</podcast:person>
    `;
    const album = parseRssFeed(buildRssWithPersonTags(tags));

    expect(album.persons).toHaveLength(1);
    expect(album.persons[0].npub).toBeUndefined();
  });
});
