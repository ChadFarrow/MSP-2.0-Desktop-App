import { describe, it, expect, vi } from 'vitest';
import { parseRssFeed, parsePublisherRssFeed, isVideoFeed, isPublisherFeed } from './xmlParser';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { createEmptyPublisherFeed } from '../types/feed';

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

describe('value recipient type detection on import', () => {
  // Build a minimal RSS feed with a channel-level value block whose recipients
  // are provided verbatim. Mirrors feeds produced by the old node-only tool.
  function buildRssWithValueBlock(recipients: string, method = 'keysend'): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Test Feed</title>
    <itunes:author>Test Artist</itunes:author>
    <description>A test feed</description>
    <language>en</language>
    <podcast:medium>music</podcast:medium>
    <podcast:guid>test-guid</podcast:guid>
    <podcast:value type="lightning" method="${method}" suggested="0.00000005000">
      ${recipients}
    </podcast:value>
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="https://example.com/track1.mp3" length="1234" type="audio/mpeg"/>
      <itunes:duration>03:45</itunes:duration>
    </item>
  </channel>
</rss>`;
  }

  // A generic, non-MSP node pubkey (the legacy MSP pubkey would be migrated to an lnaddress).
  const NODE_PUBKEY = '02aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

  it('corrects type="node" to "lnaddress" when the address contains @', () => {
    const xml = buildRssWithValueBlock(
      `<podcast:valueRecipient name="gless" type="node" address="gless@coinos.io" split="99"/>`
    );

    const album = parseRssFeed(xml);

    expect(album.value.recipients[0].type).toBe('lnaddress');
  });

  it('keeps type="node" for a node pubkey address', () => {
    const xml = buildRssWithValueBlock(
      `<podcast:valueRecipient name="Node" type="node" address="${NODE_PUBKEY}" split="1"/>`
    );

    const album = parseRssFeed(xml);

    expect(album.value.recipients[0].type).toBe('node');
  });

  it('detects lnaddress when the type attribute is missing entirely', () => {
    const xml = buildRssWithValueBlock(
      `<podcast:valueRecipient name="gless" address="gless@coinos.io" split="99"/>`
    );

    const album = parseRssFeed(xml);

    expect(album.value.recipients[0].type).toBe('lnaddress');
  });

  it('round-trips a node-only feed into method="lnaddress" output', () => {
    const xml = buildRssWithValueBlock(
      `<podcast:valueRecipient name="Node" type="node" address="${NODE_PUBKEY}" split="1"/>
       <podcast:valueRecipient name="gless" type="node" address="gless@coinos.io" split="99"/>`
    );

    const album = parseRssFeed(xml);
    const regenerated = generateRssFeed(album);

    expect(regenerated).toContain('method="lnaddress"');
    expect(regenerated).toContain('address="gless@coinos.io" split="99" type="lnaddress"');
  });
});

describe('legacy MSP 1.0 recipient migration on import', () => {
  const LEGACY_MSP_PUBKEY = '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8';

  // RSS feed with a channel-level value block (raw recipients) and a track that
  // optionally carries its own value block.
  function buildRss(channelRecipients: string, trackRecipients?: string): string {
    const trackValue = trackRecipients
      ? `<podcast:value type="lightning" method="keysend">${trackRecipients}</podcast:value>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Test Feed</title>
    <itunes:author>Test Artist</itunes:author>
    <description>A test feed</description>
    <language>en</language>
    <podcast:medium>music</podcast:medium>
    <podcast:guid>test-guid</podcast:guid>
    <podcast:value type="lightning" method="keysend">${channelRecipients}</podcast:value>
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="https://example.com/track1.mp3" length="1234" type="audio/mpeg"/>
      <itunes:duration>03:45</itunes:duration>
      ${trackValue}
    </item>
  </channel>
</rss>`;
  }

  it('swaps the old MSP node recipient to the MSP 2.0 lnaddress identity', () => {
    const xml = buildRss(
      `<podcast:valueRecipient name="Music Side Project" type="node" address="${LEGACY_MSP_PUBKEY}" split="1"/>`
    );

    const r = parseRssFeed(xml).value.recipients[0];

    expect(r.name).toBe('MSP 2.0');
    expect(r.address).toBe('musicsideproject@getalby.com');
    expect(r.type).toBe('lnaddress');
  });

  it('preserves the existing split when migrating', () => {
    const xml = buildRss(
      `<podcast:valueRecipient name="Music Side Project" type="node" address="${LEGACY_MSP_PUBKEY}" split="5"/>`
    );

    expect(parseRssFeed(xml).value.recipients[0].split).toBe(5);
  });

  it('matches the legacy pubkey case-insensitively', () => {
    const xml = buildRss(
      `<podcast:valueRecipient name="Whatever" type="node" address="${LEGACY_MSP_PUBKEY.toUpperCase()}" split="1"/>`
    );

    expect(parseRssFeed(xml).value.recipients[0].address).toBe('musicsideproject@getalby.com');
  });

  it('leaves an unrelated node recipient untouched', () => {
    const other = '02aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
    const xml = buildRss(
      `<podcast:valueRecipient name="Some Artist" type="node" address="${other}" split="1"/>`
    );

    const r = parseRssFeed(xml).value.recipients[0];

    expect(r.name).toBe('Some Artist');
    expect(r.address).toBe(other);
    expect(r.type).toBe('node');
  });

  it('migrates the legacy recipient inside a track-level value block too', () => {
    const xml = buildRss(
      `<podcast:valueRecipient name="Artist" type="node" address="02aa" split="1"/>`,
      `<podcast:valueRecipient name="Music Side Project" type="node" address="${LEGACY_MSP_PUBKEY}" split="1"/>`
    );

    const trackRecipient = parseRssFeed(xml).tracks[0].value?.recipients[0];

    expect(trackRecipient?.address).toBe('musicsideproject@getalby.com');
    expect(trackRecipient?.type).toBe('lnaddress');
  });
});

describe('podcast:image parsing', () => {
  const wrap = (channelExtra: string, itemExtra: string) => `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Test</title>
    ${channelExtra}
    <item>
      <title>Song</title>
      <guid isPermaLink="false">g1</guid>
      ${itemExtra}
    </item>
  </channel>
</rss>`;

  it('parses a channel-level podcast:image into album.podcastImages with numeric dims and aspectRatio', () => {
    const xml = wrap('<podcast:image href="https://x.com/c.jpg" purpose="canvas" alt="bg" aspect-ratio="16/9" width="1920" height="1080" type="image/jpeg" />', '');
    const album = parseRssFeed(xml);
    expect(album.podcastImages).toEqual([
      { href: 'https://x.com/c.jpg', purpose: 'canvas', alt: 'bg', aspectRatio: '16/9', width: 1920, height: 1080, type: 'image/jpeg' },
    ]);
  });

  it('parses multiple item-level podcast:image entries into track.podcastImages', () => {
    const xml = wrap('', '<podcast:image href="https://x.com/a.jpg" purpose="banner" /><podcast:image href="https://x.com/b.jpg" purpose="social" />');
    const album = parseRssFeed(xml);
    expect(album.tracks[0].podcastImages).toEqual([
      { href: 'https://x.com/a.jpg', purpose: 'banner' },
      { href: 'https://x.com/b.jpg', purpose: 'social' },
    ]);
  });

  it('still parses the legacy podcast:images tag into trackArtUrl', () => {
    const xml = wrap('', '<podcast:images srcset="https://x.com/legacy.jpg" width="3000" height="3000" />');
    const album = parseRssFeed(xml);
    expect(album.tracks[0].trackArtUrl).toBe('https://x.com/legacy.jpg');
  });

  it('round-trips podcastImages through generate -> parse', () => {
    const album = parseRssFeed(wrap('', ''));
    album.podcastImages = [{ href: 'https://x.com/c.jpg', purpose: 'canvas', aspectRatio: '16/9', width: 1920, height: 1080 }];
    album.tracks[0].podcastImages = [{ href: 'https://x.com/t.png', purpose: 'banner' }];
    const reparsed = parseRssFeed(generateRssFeed(album));
    expect(reparsed.podcastImages).toEqual(album.podcastImages);
    expect(reparsed.tracks[0].podcastImages).toEqual(album.tracks[0].podcastImages);
  });
});

describe('podcast:image on publisher feeds', () => {
  it('round-trips publisher podcastImages through generate -> parse', () => {
    const publisher = createEmptyPublisherFeed();
    publisher.title = 'Test Label';
    publisher.podcastImages = [
      { href: 'https://x.com/logo-wide.jpg', purpose: 'banner', aspectRatio: '4/1', width: 2000, height: 500 },
    ];
    const reparsed = parsePublisherRssFeed(generatePublisherRssFeed(publisher));
    expect(reparsed.podcastImages).toEqual(publisher.podcastImages);
  });
});

describe('enclosure length normalization on import', () => {
  const feedWithLength = (length: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Test Feed</title>
    <description>A test feed</description>
    <podcast:medium>music</podcast:medium>
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="https://example.com/track.mp3" length="${length}" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

  it('keeps a plausible file size', () => {
    expect(parseRssFeed(feedWithLength('74784')).tracks[0].enclosureLength).toBe('74784');
  });

  it("drops MSP's legacy 33-byte placeholder so it gets re-measured", () => {
    expect(parseRssFeed(feedWithLength('33')).tracks[0].enclosureLength).toBe('');
  });

  it('drops zero and non-numeric lengths', () => {
    expect(parseRssFeed(feedWithLength('0')).tracks[0].enclosureLength).toBe('');
    expect(parseRssFeed(feedWithLength('')).tracks[0].enclosureLength).toBe('');
    expect(parseRssFeed(feedWithLength('unknown')).tracks[0].enclosureLength).toBe('');
  });
});

describe('publisher feed sourceUrl from atom:link rel="self"', () => {
  const publisherXml = (links: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
  <channel>
    <title>Horseheads</title>
    <description>A label</description>
    <podcast:medium>publisher</podcast:medium>
    <podcast:guid>d1f4a0f6-0000-4000-8000-000000000001</podcast:guid>
    ${links}
    <podcast:remoteItem feedGuid="a1" feedUrl="https://example.com/album.xml" medium="music"/>
  </channel>
</rss>`;

  it('populates sourceUrl from the self link so a file import knows its own URL', () => {
    const feed = parsePublisherRssFeed(publisherXml(
      '<atom:link href="https://example.com/horseheads.xml" rel="self" type="application/rss+xml"/>'
    ));
    expect(feed.sourceUrl).toBe('https://example.com/horseheads.xml');
  });

  it('ignores non-self links', () => {
    const feed = parsePublisherRssFeed(publisherXml(
      '<atom:link href="https://example.com/hub" rel="hub"/>'
    ));
    expect(feed.sourceUrl).toBeUndefined();
  });

  it('picks the self link out of a list of links', () => {
    const feed = parsePublisherRssFeed(publisherXml(
      '<atom:link href="https://example.com/hub" rel="hub"/><atom:link href="https://example.com/horseheads.xml" rel="self"/>'
    ));
    expect(feed.sourceUrl).toBe('https://example.com/horseheads.xml');
  });

  it('leaves sourceUrl unset when there is no atom:link at all', () => {
    expect(parsePublisherRssFeed(publisherXml('')).sourceUrl).toBeUndefined();
  });

  it('still preserves the atom:link element for round-trip output', () => {
    const feed = parsePublisherRssFeed(publisherXml(
      '<atom:link href="https://example.com/horseheads.xml" rel="self"/>'
    ));
    expect(generatePublisherRssFeed(feed)).toContain('https://example.com/horseheads.xml');
  });
});

describe('podcast:remoteItem title attribute', () => {
  const pubWrap = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>James Goulding</title>
    <description>d</description>
    <podcast:medium>publisher</podcast:medium>
    <podcast:guid>ff83e8b5-7648-44d0-aa3c-4912f491066a</podcast:guid>
    ${items}
  </channel>
</rss>`;

  const ALBUM_GUID = '048d73a2-5ca3-4593-8d8d-bca7d9e72d4a';
  const ALBUM_URL = 'https://headstarts.uk/msp/James-Goulding/Please-Stand-By/Please_Stand_By.xml';

  it('reads title from the attribute, as the spec defines it', () => {
    // The shape Fountain emits. Reading only element text meant every
    // conforming publisher feed imported with no album titles at all.
    const feed = parsePublisherRssFeed(pubWrap(
      `<podcast:remoteItem feedGuid="${ALBUM_GUID}" feedUrl="${ALBUM_URL}" medium="music" title="Please Stand By"/>`
    ));
    expect(feed.remoteItems[0].title).toBe('Please Stand By');
  });

  it('still reads a title written as element text (feeds MSP wrote before this)', () => {
    const feed = parsePublisherRssFeed(pubWrap(
      `<podcast:remoteItem feedGuid="${ALBUM_GUID}" feedUrl="${ALBUM_URL}" medium="music">Please Stand By</podcast:remoteItem>`
    ));
    expect(feed.remoteItems[0].title).toBe('Please Stand By');
  });

  it('prefers the attribute when a feed carries both', () => {
    const feed = parsePublisherRssFeed(pubWrap(
      `<podcast:remoteItem feedGuid="${ALBUM_GUID}" medium="music" title="From attribute">From text</podcast:remoteItem>`
    ));
    expect(feed.remoteItems[0].title).toBe('From attribute');
  });

  it('emits title as a self-closing attribute, never as element text', () => {
    const feed = parsePublisherRssFeed(pubWrap(
      `<podcast:remoteItem feedGuid="${ALBUM_GUID}" feedUrl="${ALBUM_URL}" medium="music">Please Stand By</podcast:remoteItem>`
    ));
    const xml = generatePublisherRssFeed(feed);

    expect(xml).toContain('title="Please Stand By"');
    expect(xml).not.toContain('>Please Stand By</podcast:remoteItem>');
    expect(xml).toMatch(/<podcast:remoteItem [^>]*\/>/);
  });

  it('round-trips the legacy text form into the spec form without losing feedImg', () => {
    const IMG = 'https://headstarts.uk/msp/James-Goulding/Please-Stand-By/psb.jpeg';
    const feed = parsePublisherRssFeed(pubWrap(
      `<podcast:remoteItem feedGuid="${ALBUM_GUID}" feedUrl="${ALBUM_URL}" medium="music" feedImg="${IMG}">Please Stand By</podcast:remoteItem>`
    ));
    const reparsed = parsePublisherRssFeed(generatePublisherRssFeed(feed));

    expect(reparsed.remoteItems[0]).toEqual({
      feedGuid: ALBUM_GUID,
      feedUrl: ALBUM_URL,
      medium: 'music',
      title: 'Please Stand By',
      image: IMG
    });
  });
});

describe('podcast:publisher parsing', () => {
  const wrap = (publisherXml: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Album</title>
    <description>d</description>
    <podcast:medium>music</podcast:medium>
    ${publisherXml}
  </channel>
</rss>`;

  const GUID = 'ff83e8b5-7648-44d0-aa3c-4912f491066a';
  const URL = 'https://headstarts.uk/msp/publisher-feeds/James_Goulding.xml';

  it('reads the canonical nested form', () => {
    const album = parseRssFeed(wrap(
      `<podcast:publisher><podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/></podcast:publisher>`
    ));
    expect(album.publisher).toEqual({ feedGuid: GUID, feedUrl: URL });
  });

  it('reads attributes written directly on podcast:publisher', () => {
    // Out of spec, but it occurs in the wild. This used to return undefined, and
    // because 'podcast:publisher' is a known channel key it was excluded from
    // unknownChannelElements too — so a parse/regenerate deleted it outright.
    const album = parseRssFeed(wrap(
      `<podcast:publisher medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>`
    ));
    expect(album.publisher).toEqual({ feedGuid: GUID, feedUrl: URL });
  });

  it('survives more than one nested remoteItem', () => {
    // fast-xml-parser returns an array here, and getAttr yields '' for an array,
    // so this used to drop the publisher entirely rather than take the first.
    const album = parseRssFeed(wrap(
      `<podcast:publisher>
         <podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>
         <podcast:remoteItem medium="publisher" feedGuid="second-guid" feedUrl="https://example.com/other.xml"/>
       </podcast:publisher>`
    ));
    expect(album.publisher).toEqual({ feedGuid: GUID, feedUrl: URL });
  });

  it('normalizes a malformed publisher to the canonical nested form on output', () => {
    const album = parseRssFeed(wrap(
      `<podcast:publisher medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>`
    ));
    expect(generateRssFeed(album)).toContain(
      `<podcast:publisher>\n            <podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}" />\n        </podcast:publisher>`
    );
  });

  it('leaves publisher undefined when there is nothing to read', () => {
    const album = parseRssFeed(wrap('<podcast:publisher></podcast:publisher>'));
    expect(album.publisher).toBeUndefined();
  });

  it('reads a bare channel-level remoteItem with medium="publisher"', () => {
    const album = parseRssFeed(wrap(
      `<podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>`
    ));
    expect(album.publisher).toEqual({ feedGuid: GUID, feedUrl: URL });
  });

  it('emits exactly one publisher reference for a bare remoteItem, even after an overwrite', () => {
    // The Download Catalog flows set album.publisher unconditionally after
    // parsing. If the bare remoteItem had merely been passed through as an
    // unknown element it would be re-emitted next to the generated
    // <podcast:publisher> block, and Download Feed rewrites somebody else's
    // file — so this is corruption, not just noise.
    const album = parseRssFeed(wrap(
      `<podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>`
    ));
    album.publisher = { feedGuid: 'new-guid', feedUrl: 'https://example.com/pub.xml' };

    const xml = generateRssFeed(album);
    expect(xml.match(/medium="publisher"/g)).toHaveLength(1);
    expect(xml).toContain('new-guid');
    expect(xml).not.toContain(GUID);
  });

  it('still round-trips a podroll alongside a bare publisher remoteItem', () => {
    // Only the publisher-medium entry is consumed; other mediums are podroll and
    // must survive untouched.
    const album = parseRssFeed(wrap(
      `<podcast:remoteItem medium="publisher" feedGuid="${GUID}" feedUrl="${URL}"/>
    <podcast:remoteItem feedGuid="aaaaaaaa-0000-0000-0000-000000000001" medium="music"/>
    <podcast:remoteItem feedGuid="aaaaaaaa-0000-0000-0000-000000000002" medium="music"/>`
    ));

    const xml = generateRssFeed(album);
    expect(xml.match(/medium="publisher"/g)).toHaveLength(1);
    expect(xml).toContain('aaaaaaaa-0000-0000-0000-000000000001');
    expect(xml).toContain('aaaaaaaa-0000-0000-0000-000000000002');
  });
});

describe('harmless extras round-trip', () => {
  // A feed carrying spec-valid tags MSP doesn't edit. Each one used to be
  // dropped on import, so a parse→regenerate quietly deleted it.
  function buildFeedWithExtras(explicit = 'true'): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Extras</title>
    <itunes:author>Artist</itunes:author>
    <description>A feed with extras</description>
    <language>en</language>
    <podcast:medium>music</podcast:medium>
    <podcast:guid>c7d1b2a0-1111-4222-8333-444455556666</podcast:guid>
    <podcast:locked>yes</podcast:locked>
    <podcast:txt purpose="npub">npub1artist</podcast:txt>
    <podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>
    <itunes:category text="Music">
      <itunes:category text="Music History"/>
    </itunes:category>
    <itunes:explicit>${explicit}</itunes:explicit>
    <podcast:value type="lightning" method="lnaddress">
      <podcast:valueRecipient name="Artist" address="artist@getalby.com" split="95" type="lnaddress"/>
      <podcast:valueRecipient name="Host" address="host@getalby.com" split="5" type="lnaddress" fee="true"/>
    </podcast:value>
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="https://example.com/t1.mp3" length="123456" type="audio/mpeg"/>
      <itunes:duration>03:45</itunes:duration>
      <podcast:value type="lightning" method="lnaddress">
        <podcast:valueRecipient name="Artist" address="artist@getalby.com" split="95" type="lnaddress"/>
        <podcast:valueRecipient name="Host" address="host@getalby.com" split="5" type="lnaddress" fee="true"/>
        <podcast:valueTimeSplit startTime="60" duration="30" remotePercentage="90">
          <podcast:remoteItem feedGuid="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" itemGuid="guest-track"/>
        </podcast:valueTimeSplit>
      </podcast:value>
    </item>
  </channel>
</rss>`;
  }

  it('keeps the recipient fee attribute', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    expect(album.value.recipients[1].fee).toBe(true);
    expect(album.value.recipients[0].fee).toBeUndefined();
    const xml = generateRssFeed(album);
    expect(xml).toContain('name="Host" address="host@getalby.com" split="5" type="lnaddress" fee="true" />');
    expect(xml).not.toContain('name="Artist" address="artist@getalby.com" split="95" type="lnaddress" fee=');
  });

  it('keeps <podcast:valueTimeSplit> inside the item value block', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    const track = album.tracks[0];
    // The item block differs from the channel's only by its time split, so it must
    // still count as an override — otherwise the channel block is written instead.
    expect(track.overrideValue).toBe(true);
    const xml = generateRssFeed(album);
    const item = xml.slice(xml.indexOf('<item>'), xml.indexOf('</item>'));
    expect(item).toMatch(
      /<podcast:value [^>]*>\s*<podcast:valueRecipient name="Artist"[^>]*\/>\s*<podcast:valueRecipient name="Host"[^>]*fee="true" \/>\s*<podcast:valueTimeSplit startTime="60" duration="30" remotePercentage="90">\s*<podcast:remoteItem feedGuid="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" itemGuid="guest-track" \/>\s*<\/podcast:valueTimeSplit>\s*<\/podcast:value>/
    );
  });

  it('writes the npub txt once and keeps every other podcast:txt', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    expect(album.artistNpub).toBe('npub1artist');
    const xml = generateRssFeed(album);
    expect(xml.match(/purpose="npub"/g)).toHaveLength(1);
    expect(xml).toContain('<podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>');
  });

  it('keeps a second npub txt rather than dropping it', () => {
    const xml = buildFeedWithExtras().replace(
      '<podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>',
      '<podcast:txt purpose="npub">npub1other</podcast:txt>'
    );
    const out = generateRssFeed(parseRssFeed(xml));
    expect(out).toContain('<podcast:txt purpose="npub">npub1artist</podcast:txt>');
    expect(out).toContain('<podcast:txt purpose="npub">npub1other</podcast:txt>');
    expect(out.match(/purpose="npub"/g)).toHaveLength(2);
  });

  it('keeps every podcast:txt on a publisher feed', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Label</title>
    <podcast:medium>publisher</podcast:medium>
    <podcast:guid>c7d1b2a0-1111-4222-8333-444455556666</podcast:guid>
    <podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>
    <podcast:txt>free text</podcast:txt>
  </channel>
</rss>`;
    const out = generatePublisherRssFeed(parsePublisherRssFeed(xml));
    expect(out).toContain('<podcast:txt purpose="applepodcastsverify">abc-123</podcast:txt>');
    expect(out).toContain('<podcast:txt>free text</podcast:txt>');
  });

  it('keeps nested itunes:category subcategories', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    expect(album.categories).toEqual(['Music']);
    expect(album.subcategories).toEqual({ Music: ['Music History'] });
    const xml = generateRssFeed(album);
    expect(xml).toMatch(
      /<itunes:category text="Music">\s*<itunes:category text="Music History" \/>\s*<\/itunes:category>/
    );
  });

  it('writes a plain category self-closing when it has no subcategories', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    album.subcategories = undefined;
    expect(generateRssFeed(album)).toContain('<itunes:category text="Music" />');
  });

  it('reads the legacy itunes:explicit words', () => {
    for (const word of ['yes', 'Yes', 'explicit', 'true']) {
      expect(parseRssFeed(buildFeedWithExtras(word)).explicit).toBe(true);
    }
    for (const word of ['no', 'clean', 'false']) {
      expect(parseRssFeed(buildFeedWithExtras(word)).explicit).toBe(false);
    }
  });

  it('reads the legacy explicit words at item level too', () => {
    const xml = buildFeedWithExtras().replace(
      '<itunes:duration>03:45</itunes:duration>',
      '<itunes:duration>03:45</itunes:duration>\n      <itunes:explicit>yes</itunes:explicit>'
    );
    expect(parseRssFeed(xml).tracks[0].explicit).toBe(true);
  });

  it('passes number-shaped values through exactly as written', () => {
    const xml = buildFeedWithExtras()
      .replace('abc-123', '0012345')
      .replace('itemGuid="guest-track"', 'itemGuid="0012345"')
      .replace('<itunes:duration>03:45</itunes:duration>',
        '<itunes:duration>03:45</itunes:duration>\n      <custom:id xmlns:custom="https://example.com/ns" big="12345678901234567890123">5e10</custom:id>');
    const out = generateRssFeed(parseRssFeed(xml));
    expect(out).toContain('<podcast:txt purpose="applepodcastsverify">0012345</podcast:txt>');
    expect(out).toContain('itemGuid="0012345"');
    expect(out).toContain('big="12345678901234567890123"');
    expect(out).toContain('>5e10</custom:id>');
  });

  it('survives a category named like a built-in object key', () => {
    const xml = buildFeedWithExtras().replace(
      '<itunes:category text="Music">',
      '<itunes:category text="constructor"><itunes:category text="Sub"/></itunes:category>\n    <itunes:category text="Music">'
    );
    const album = parseRssFeed(xml);
    expect(album.subcategories).toEqual({ constructor: ['Sub'], Music: ['Music History'] });
    expect(generateRssFeed(album)).toMatch(/<itunes:category text="constructor">\s*<itunes:category text="Sub" \/>/);
    album.subcategories = { Music: ['Music History'] };
    expect(generateRssFeed(album)).toContain('<itunes:category text="constructor" />');
  });

  it('keeps <podcast:locked> when the feed names no owner', () => {
    const album = parseRssFeed(buildFeedWithExtras());
    expect(album.locked).toBe(true);
    expect(album.lockedOwner).toBe('');
    expect(generateRssFeed(album)).toContain('<podcast:locked>yes</podcast:locked>');
  });
});
