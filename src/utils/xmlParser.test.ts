import { describe, it, expect } from 'vitest';
import { parseRssFeed } from './xmlParser';

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
