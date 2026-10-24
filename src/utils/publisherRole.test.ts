import { describe, it, expect } from 'vitest';
import { catalogRole, normalizeRel, roleTokens, withRole, withRoleToken } from './publisherRole';
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

describe('catalogRole with token sets (podcast-namespace PR #793)', () => {
  it('reads the same roles in another order, case or separator as one role', () => {
    expect(catalogRole([item('a', 'producer artist'), item('b', 'Artist, producer')])).toBe('artist producer');
  });

  it('is null when the token sets differ', () => {
    expect(catalogRole([item('a', 'artist producer'), item('b', 'artist')])).toBeNull();
  });
});

describe('roleTokens', () => {
  it('splits on spaces and commas, and drops duplicates', () => {
    expect(roleTokens('artist,  producer artist')).toEqual(['artist', 'producer']);
  });

  it('matches a known token in any letter case, and keeps an unknown one as written', () => {
    expect(roleTokens('Artist Composer composer')).toEqual(['artist', 'Composer']);
  });

  it('gives known tokens in the order of the proposal, then unknown ones', () => {
    expect(roleTokens('composer sponsor label')).toEqual(['label', 'sponsor', 'composer']);
  });

  it('is empty when no role is stated', () => {
    expect(roleTokens(undefined)).toEqual([]);
    expect(roleTokens('  ')).toEqual([]);
    expect(normalizeRel(undefined)).toBe('');
  });
});

describe('withRoleToken', () => {
  it('turns a token on, in the canonical order', () => {
    expect(withRoleToken('producer', 'artist', true)).toBe('artist producer');
  });

  it('does not add an imported token a second time in another case', () => {
    // An imported rel="Artist" plus the Artist checkbox used to give "artist Artist".
    expect(withRoleToken('Artist', 'artist', true)).toBe('artist');
  });

  it('turns a known or an unknown token off, and gives "" when none is left', () => {
    expect(withRoleToken('artist Composer', 'composer', false)).toBe('artist');
    expect(withRoleToken('Artist', 'artist', false)).toBe('');
  });
});

describe('withRole', () => {
  it('sets the role', () => {
    expect(withRole(item('a'), 'artist').rel).toBe('artist');
  });

  it("works on an album's publisher reference too", () => {
    expect(withRole({ feedGuid: 'p', rel: 'label' }, '')).toEqual({ feedGuid: 'p' });
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
