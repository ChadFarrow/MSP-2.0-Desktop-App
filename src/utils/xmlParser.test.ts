import { describe, it, expect } from 'vitest';
import { parseRssFeed } from './xmlParser';
import { generateRssFeed } from './xmlGenerator';

// Helper to build minimal RSS XML for testing
function buildRssXml(enclosureUrl: string, podcastGuid?: string): string {
  const guidTag = podcastGuid ? `<podcast:guid>${podcastGuid}</podcast:guid>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>Test Feed</title>
    <itunes:author>Test Artist</itunes:author>
    <description>A test feed</description>
    <language>en</language>
    <podcast:medium>music</podcast:medium>
    ${guidTag}
    <item>
      <title>Track 1</title>
      <guid isPermaLink="false">track-guid-1</guid>
      <enclosure url="${enclosureUrl}" length="1234" type="audio/mpeg"/>
      <itunes:duration>03:45</itunes:duration>
    </item>
  </channel>
</rss>`;
}

describe('OP3 prefix detection and stripping', () => {
  it('detects OP3 prefix and sets op3=true', () => {
    const xml = buildRssXml(
      'https://op3.dev/e,pg=test-guid/example.com/track1.mp3',
      'test-guid'
    );

    const album = parseRssFeed(xml);

    expect(album.op3).toBe(true);
  });

  it('strips OP3 prefix from enclosure URLs', () => {
    const xml = buildRssXml(
      'https://op3.dev/e,pg=test-guid/example.com/track1.mp3',
      'test-guid'
    );

    const album = parseRssFeed(xml);

    expect(album.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
    expect(album.tracks[0].enclosureUrl).not.toContain('op3.dev');
  });

  it('strips OP3 prefix without pg parameter', () => {
    const xml = buildRssXml('https://op3.dev/e/example.com/track1.mp3');

    const album = parseRssFeed(xml);

    expect(album.op3).toBe(true);
    expect(album.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
  });

  it('preserves HTTP protocol when stripping OP3 prefix', () => {
    const xml = buildRssXml(
      'https://op3.dev/e,pg=test-guid/http://example.com/track1.mp3',
      'test-guid'
    );

    const album = parseRssFeed(xml);

    expect(album.op3).toBe(true);
    expect(album.tracks[0].enclosureUrl).toBe('http://example.com/track1.mp3');
  });

  it('sets op3=false when no OP3 prefix', () => {
    const xml = buildRssXml('https://example.com/track1.mp3');

    const album = parseRssFeed(xml);

    expect(album.op3).toBe(false);
    expect(album.tracks[0].enclosureUrl).toBe('https://example.com/track1.mp3');
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
    expect(r.address).toBe('chadf@getalby.com');
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

    expect(parseRssFeed(xml).value.recipients[0].address).toBe('chadf@getalby.com');
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

    expect(trackRecipient?.address).toBe('chadf@getalby.com');
    expect(trackRecipient?.type).toBe('lnaddress');
  });
});
