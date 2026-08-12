import { describe, it, expect } from 'vitest';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { parseRssFeed } from './xmlParser';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyTrack } from '../types/feed';

describe('xmlGenerator publisher reference', () => {
  it('includes podcast:publisher tag when publisher is set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: 'abc123-guid',
      feedUrl: 'https://example.com/publisher-feed.xml'
    };

    const xml = generateRssFeed(album);

    // Asserted as one block, not as independent substrings. The spec requires
    // <podcast:publisher> to CONTAIN exactly one <podcast:remoteItem
    // medium="publisher">, and separate toContain checks would pass just as
    // happily with an empty publisher element and the remoteItem emitted as a
    // sibling somewhere else in the channel — which is precisely the shape a
    // reviewer once claimed MSP was producing.
    expect(xml).toContain(
      '<podcast:publisher>\n' +
      '            <podcast:remoteItem medium="publisher" feedGuid="abc123-guid" feedUrl="https://example.com/publisher-feed.xml" />\n' +
      '        </podcast:publisher>'
    );
  });

  it('round-trips a publisher reference through the parser', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: 'ff83e8b5-7648-44d0-aa3c-4912f491066a',
      feedUrl: 'https://headstarts.uk/msp/publisher-feeds/James_Goulding.xml'
    };

    const reparsed = parseRssFeed(generateRssFeed(album));

    expect(reparsed.publisher).toEqual(album.publisher);
  });

  it('keeps a channel-level podroll remoteItem through a parse/regenerate cycle', () => {
    // The Download Feed flow is parse→regenerate. Album feeds don't model a
    // podroll, so it has to survive as an unknown channel element or MSP eats
    // the publisher's tag on their behalf.
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Album</title>
    <description>d</description>
    <podcast:medium>music</podcast:medium>
    <podcast:remoteItem feedGuid="roll-1" feedUrl="https://example.com/friend.xml" medium="music"/>
  </channel>
</rss>`;

    const regenerated = generateRssFeed(parseRssFeed(source));

    expect(regenerated).toContain('feedGuid="roll-1"');
    expect(regenerated).toContain('https://example.com/friend.xml');
  });

  it('does not include podcast:publisher tag when publisher is not set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('<podcast:publisher>');
  });

  it('does not include podcast:publisher tag when publisher has no guid or url', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: '',
      feedUrl: ''
    };

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('<podcast:publisher>');
  });

  it('includes publisher with only feedUrl when feedGuid is empty', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: '',
      feedUrl: 'https://example.com/publisher-feed.xml'
    };

    const xml = generateRssFeed(album);

    expect(xml).toContain('<podcast:publisher>');
    expect(xml).toContain('feedUrl="https://example.com/publisher-feed.xml"');
    expect(xml).not.toContain('feedGuid=""');
  });

  it('includes publisher with only feedGuid when feedUrl is empty', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.publisher = {
      feedGuid: 'abc123-guid',
      feedUrl: ''
    };

    const xml = generateRssFeed(album);

    expect(xml).toContain('<podcast:publisher>');
    expect(xml).toContain('feedGuid="abc123-guid"');
    expect(xml).not.toContain('feedUrl=""');
  });
});

describe('OP3 analytics prefix', () => {
  it('prefixes HTTPS enclosure URLs when op3 is enabled', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'test-guid-123';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // HTTPS URLs have their protocol stripped after the prefix
    expect(xml).toContain('url="https://op3.dev/e,pg=test-guid-123/example.com/track1.mp3"');
  });

  it('prefixes HTTP enclosure URLs keeping full URL', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'test-guid-123';
    album.tracks[0].enclosureUrl = 'http://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // HTTP URLs keep the full URL after the prefix
    expect(xml).toContain('url="https://op3.dev/e,pg=test-guid-123/http://example.com/track1.mp3"');
  });

  it('includes pg parameter when podcastGuid is set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = 'my-podcast-guid';
    album.tracks[0].enclosureUrl = 'https://example.com/track.mp3';

    const xml = generateRssFeed(album);

    expect(xml).toContain(',pg=my-podcast-guid/');
  });

  it('does not prefix when op3 is false', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = false;
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    expect(xml).not.toContain('op3.dev');
    expect(xml).toContain('url="https://example.com/track1.mp3"');
  });

  it('works without podcastGuid', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.op3 = true;
    album.podcastGuid = '';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';

    const xml = generateRssFeed(album);

    // No ,pg= parameter when podcastGuid is empty
    expect(xml).toContain('url="https://op3.dev/e/example.com/track1.mp3"');
    expect(xml).not.toContain(',pg=');
  });
});

describe('OP3 round-trip', () => {
  it('generate with OP3 → parse → op3=true with clean URLs', () => {
    const album = createEmptyAlbum();
    album.title = 'Round Trip Album';
    album.author = 'Test Artist';
    album.description = 'Testing round-trip';
    album.op3 = true;
    album.podcastGuid = 'round-trip-guid';
    album.tracks[0].title = 'Track 1';
    album.tracks[0].enclosureUrl = 'https://example.com/track1.mp3';
    album.tracks[0].enclosureType = 'audio/mpeg';

    // Generate XML with OP3 prefixes
    const xml = generateRssFeed(album);
    expect(xml).toContain('op3.dev');

    // Parse it back
    const parsed = parseRssFeed(xml);

    // Should detect OP3 and set flag
    expect(parsed.op3).toBe(true);

    // Track URLs should be clean (OP3 prefix stripped)
    expect(parsed.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
    expect(parsed.tracks[0].enclosureUrl).not.toContain('op3.dev');
  });
});

describe('Person npub attribute', () => {
  const sampleNpub = 'npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s';

  it('emits npub attribute on podcast:person when set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.persons = [
      {
        name: 'Alice',
        href: 'https://example.com/alice',
        img: 'https://example.com/alice.jpg',
        npub: sampleNpub,
        roles: [{ group: 'music', role: 'vocalist' }]
      }
    ];

    const xml = generateRssFeed(album);

    expect(xml).toContain(`npub="${sampleNpub}"`);
    expect(xml).toContain('<podcast:person');
    expect(xml).toContain('>Alice</podcast:person>');
  });

  it('omits npub attribute when not set', () => {
    const album = createEmptyAlbum();
    album.title = 'Test Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.persons = [
      {
        name: 'Bob',
        href: 'https://example.com/bob',
        roles: [{ group: 'music', role: 'guitarist' }]
      }
    ];

    const xml = generateRssFeed(album);

    expect(xml).toContain('>Bob</podcast:person>');
    expect(xml).not.toContain('npub=');
  });

  it('roundtrip preserves npub through generate → parse', () => {
    const album = createEmptyAlbum();
    album.title = 'Roundtrip Album';
    album.author = 'Test Artist';
    album.description = 'Test description';
    album.persons = [
      {
        name: 'Carol',
        href: 'https://example.com/carol',
        img: '',
        npub: sampleNpub,
        roles: [{ group: 'music', role: 'drummer' }]
      }
    ];

    const xml = generateRssFeed(album);
    const parsed = parseRssFeed(xml);

    expect(parsed.persons).toHaveLength(1);
    expect(parsed.persons[0].name).toBe('Carol');
    expect(parsed.persons[0].npub).toBe(sampleNpub);
    expect(parsed.persons[0].roles).toEqual([{ group: 'music', role: 'drummer' }]);
  });
});

describe('podcast:image generation', () => {
  it('emits a channel-level <podcast:image> for each album image, with only non-empty attrs', () => {
    const album = createEmptyAlbum();
    album.title = 'Test';
    album.podcastImages = [
      { href: 'https://x.com/canvas.jpg', purpose: 'canvas', alt: 'wide bg', aspectRatio: '16/9', width: 1920, height: 1080, type: 'image/jpeg' },
    ];
    const xml = generateRssFeed(album);
    expect(xml).toContain('<podcast:image href="https://x.com/canvas.jpg" purpose="canvas" alt="wide bg" aspect-ratio="16/9" width="1920" height="1080" type="image/jpeg" />');
  });

  it('emits an item-level <podcast:image> for track images', () => {
    const album = createEmptyAlbum();
    album.tracks[0].title = 'Song';
    album.tracks[0].podcastImages = [{ href: 'https://x.com/t.png', purpose: 'banner' }];
    const xml = generateRssFeed(album);
    expect(xml).toContain('<podcast:image href="https://x.com/t.png" purpose="banner" />');
  });

  it('no longer emits the deprecated <podcast:images> tag', () => {
    const album = createEmptyAlbum();
    album.tracks[0].trackArtUrl = 'https://x.com/art.jpg';
    album.tracks[0].trackArtWidth = 3000;
    const xml = generateRssFeed(album);
    expect(xml).not.toContain('<podcast:images');
  });
});

describe('xmlGenerator track order', () => {
  const threeTrackAlbum = () => {
    const album = createEmptyAlbum();
    album.title = 'Ordered Album';
    album.tracks = ['One', 'Two', 'Three'].map((title, i) => ({
      ...album.tracks[0],
      id: `id-${i}`,
      guid: `guid-${i}`,
      trackNumber: i + 1,
      title,
      // Descending, as the store now stamps them.
      pubDate: new Date(Date.parse('2025-02-01T00:02:00Z') - i * 60_000).toUTCString()
    }));
    return album;
  };

  it('emits items in list order', () => {
    const xml = generateRssFeed(threeTrackAlbum());
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>/g)].map(m => m[1]);
    expect(titles).toEqual(['One', 'Two', 'Three']);
  });

  it('emits item pubDates in descending order so newest-first apps play track 1 first', () => {
    const xml = generateRssFeed(threeTrackAlbum());
    const items = xml.split('<item>').slice(1);
    const times = items.map(item => Date.parse(/<pubDate>(.*?)<\/pubDate>/.exec(item)![1]));
    expect(times).toHaveLength(3);
    expect(times.every((t, i) => i === 0 || t < times[i - 1])).toBe(true);
  });

  it('emits ascending podcast:episode numbers alongside descending dates', () => {
    const xml = generateRssFeed(threeTrackAlbum());
    const episodes = [...xml.matchAll(/<podcast:episode>(\d+)<\/podcast:episode>/g)].map(m => Number(m[1]));
    expect(episodes).toEqual([1, 2, 3]);
  });
});

describe('RSS validity: image link and atom self-link', () => {
  it('emits <link> inside <image>, falling back to the channel link', () => {
    // RSS 2.0 requires url + title + link. Omitting it made every MSP feed fail
    // the W3C validator with an *error*, not a warning.
    const album = createEmptyAlbum();
    album.title = 'Please Stand By';
    album.link = 'https://jamesgoulding.bandcamp.com/';
    album.imageUrl = 'https://example.com/cover.jpg';
    album.imageLink = '';

    const xml = generateRssFeed(album);
    expect(xml).toContain('<link>https://jamesgoulding.bandcamp.com/</link>');
    expect(xml).toMatch(/<image>[\s\S]*<link>[\s\S]*<\/image>/);
  });

  it('prefers an explicit imageLink over the channel link', () => {
    const album = createEmptyAlbum();
    album.link = 'https://example.com/site';
    album.imageUrl = 'https://example.com/cover.jpg';
    album.imageLink = 'https://example.com/art-page';

    expect(generateRssFeed(album)).toContain('<link>https://example.com/art-page</link>');
  });

  it('emits atom:link rel="self" from a publisher sourceUrl, with the namespace declared', () => {
    const feed = createEmptyPublisherFeed();
    feed.title = 'James Goulding';
    feed.sourceUrl = 'https://headstarts.uk/msp/publisher-feeds/James_Goulding.xml';

    const xml = generatePublisherRssFeed(feed);
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain(
      '<atom:link href="https://headstarts.uk/msp/publisher-feeds/James_Goulding.xml" rel="self" type="application/rss+xml" />'
    );
  });

  it('never guesses a self-link when sourceUrl is unknown', () => {
    const feed = createEmptyPublisherFeed();
    feed.title = 'No source';
    expect(generatePublisherRssFeed(feed)).not.toContain('rel="self"');
  });

  it('does not emit a second self-link when the imported one round-trips', () => {
    // atom:link is deliberately absent from KNOWN_CHANNEL_KEYS, so an imported
    // self-link is re-emitted from unknownChannelElements. Generating another
    // from sourceUrl would duplicate the element.
    const feed = createEmptyPublisherFeed();
    feed.sourceUrl = 'https://example.com/pub.xml';
    feed.unknownChannelElements = {
      'atom:link': {
        '@_href': 'https://example.com/pub.xml',
        '@_rel': 'self',
        '@_type': 'application/rss+xml'
      }
    };

    const xml = generatePublisherRssFeed(feed);
    expect(xml.match(/rel="self"/g)).toHaveLength(1);
  });

  it('still emits its own self-link when the passthrough only has other rels', () => {
    const feed = createEmptyPublisherFeed();
    feed.sourceUrl = 'https://example.com/pub.xml';
    feed.unknownChannelElements = {
      'atom:link': { '@_href': 'https://example.com/hub', '@_rel': 'hub' }
    };

    const xml = generatePublisherRssFeed(feed);
    expect(xml.match(/rel="self"/g)).toHaveLength(1);
    expect(xml).toContain('rel="hub"');
  });
});

describe('XML escaping at every interpolation site', () => {
  // Each of these fields reaches the generator from a third-party feed via
  // Import-from-URL or the publisher Download Feed, and MSP then *hosts* the
  // regenerated result — so an unescaped one means MSP emits a malformed or
  // structurally altered document over its own name. A bare & is enough.
  const raw = 'a & b';

  it('escapes <language>', () => {
    const album = createEmptyAlbum();
    album.language = raw;
    const xml = generateRssFeed(album);
    expect(xml).toContain('<language>a &amp; b</language>');
    expect(xml).not.toContain('<language>a & b</language>');
  });

  it('escapes <podcast:medium>', () => {
    const album = createEmptyAlbum();
    // medium is typed as a union but the parser produces it with a cast, not a
    // validation (`getText(...) as 'music' | 'video'`), so any text can land here.
    album.medium = raw as unknown as 'music';
    expect(generateRssFeed(album)).toContain('<podcast:medium>a &amp; b</podcast:medium>');
  });

  it('escapes the suggested= attribute of podcast:value', () => {
    const album = createEmptyAlbum();
    album.value.suggested = '0.1" onload="x';
    album.value.recipients = [
      { name: 'A', address: 'a@b.com', split: 100, type: 'lnaddress' }
    ];
    const xml = generateRssFeed(album);
    expect(xml).toContain('suggested="0.1&quot; onload=&quot;x"');
  });

  it('escapes the enclosure length= attribute and itunes:duration', () => {
    const album = createEmptyAlbum();
    album.tracks = [
      {
        ...createEmptyTrack(1),
        enclosureUrl: 'https://example.com/a.mp3',
        enclosureLength: '123" x="y',
        duration: '00:03:00 & more'
      }
    ];
    const xml = generateRssFeed(album);
    expect(xml).toContain('length="123&quot; x=&quot;y"');
    expect(xml).toContain('<itunes:duration>00:03:00 &amp; more</itunes:duration>');
  });
});
