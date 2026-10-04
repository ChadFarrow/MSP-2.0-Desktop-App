import { describe, it, expect } from 'vitest';
import { catalogRole, withRole } from './publisherRole';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { parseRssFeed, parsePublisherRssFeed } from './xmlParser';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyRemoteItem } from '../types/feed';
import type { RemoteItem } from '../types/feed';

const item = (feedGuid: string, rel?: string): RemoteItem => ({
  ...createEmptyRemoteItem(),
  feedGuid,
  feedUrl: `https://example.com/${feedGuid}.xml`,
  medium: 'music',
  ...(rel === undefined ? {} : { rel })
});

describe('catalogRole', () => {
  it('is not stated for an empty catalog', () => {
    expect(catalogRole([])).toBe('');
  });

  it('is not stated when no item states a role', () => {
    expect(catalogRole([item('a'), item('b')])).toBe('');
  });

  it('is the shared role when every item states the same one', () => {
    expect(catalogRole([item('a', 'label'), item('b', 'label')])).toBe('label');
  });

  it('is null when the items differ', () => {
    expect(catalogRole([item('a', 'label'), item('b')])).toBeNull();
  });
});

describe('withRole', () => {
  it('sets the role', () => {
    expect(withRole(item('a'), 'artist').rel).toBe('artist');
  });

  it('removes rel for "Not stated" rather than writing an empty value', () => {
    expect(withRole(item('a', 'label'), '')).not.toHaveProperty('rel');
  });
});

describe('rel on the publisher feed side', () => {
  it('writes rel on each catalog remoteItem that states a role', () => {
    const feed = createEmptyPublisherFeed();
    feed.title = 'Some Label';
    feed.remoteItems = [item('album-1', 'label')];

    expect(generatePublisherRssFeed(feed)).toContain(
      '<podcast:remoteItem feedGuid="album-1" feedUrl="https://example.com/album-1.xml" medium="music" rel="label" />'
    );
  });

  it('writes no rel attribute when the role is not stated', () => {
    const feed = createEmptyPublisherFeed();
    feed.title = 'Some Artist';
    feed.remoteItems = [item('album-1')];

    expect(generatePublisherRssFeed(feed)).not.toContain('rel="');
  });

  it('round-trips rel through the publisher feed parser', () => {
    const feed = createEmptyPublisherFeed();
    feed.title = 'Some Label';
    feed.remoteItems = [item('album-1', 'label'), item('album-2', 'label')];

    const reparsed = parsePublisherRssFeed(generatePublisherRssFeed(feed));

    expect(reparsed.remoteItems.map(i => i.rel)).toEqual(['label', 'label']);
  });
});

describe('rel on the album side', () => {
  it('writes rel inside the podcast:publisher block', () => {
    const album = createEmptyAlbum();
    album.title = 'Album';
    album.publisher = {
      feedGuid: 'label-guid',
      feedUrl: 'https://example.com/label.xml',
      rel: 'label'
    };

    // Asserted as one block, like the existing publisher reference test.
    expect(generateRssFeed(album)).toContain(
      '<podcast:publisher>\n' +
      '            <podcast:remoteItem medium="publisher" feedGuid="label-guid" feedUrl="https://example.com/label.xml" rel="label" />\n' +
      '        </podcast:publisher>'
    );
  });

  it('round-trips rel through the album parser', () => {
    const album = createEmptyAlbum();
    album.title = 'Album';
    album.publisher = { feedGuid: 'artist-guid', feedUrl: 'https://example.com/artist.xml', rel: 'artist' };

    expect(parseRssFeed(generateRssFeed(album)).publisher).toEqual(album.publisher);
  });

  it('keeps the rel of a third-party album through a parse/regenerate cycle', () => {
    // Download Feed and processCatalogFeed are parse→regenerate over someone
    // else's feed. Before rel was modelled, this dropped the role a feed states.
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Album</title>
    <description>d</description>
    <podcast:medium>music</podcast:medium>
    <podcast:publisher>
      <podcast:remoteItem medium="publisher" rel="label" feedGuid="label-guid" feedUrl="https://example.com/label.xml" />
    </podcast:publisher>
  </channel>
</rss>`;

    expect(generateRssFeed(parseRssFeed(source))).toContain('rel="label"');
  });
});
