import { describe, it, expect } from 'vitest';
import {
  fromParties,
  linkPublisher,
  publisherParties,
  sameGuid,
  samePublisher,
  withPartyGuid
} from './publisherParties';
import { generateRssFeed } from './xmlGenerator';
import { parseRssFeed } from './xmlParser';
import { createEmptyAlbum } from '../types/feed';
import type { PublisherReference } from '../types/feed';

const party = (feedGuid: string, rel?: string): PublisherReference => ({
  feedGuid,
  feedUrl: `https://example.com/${feedGuid}.xml`,
  ...(rel === undefined ? {} : { rel })
});

const feed = (channel: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Drift</title>
    <description>d</description>
    <podcast:medium>music</podcast:medium>
    ${channel}
  </channel>
</rss>`;

// An album released by a label and credited to its artist: two parties
// inside one <podcast:publisher>, primary first (podcast-namespace PR #793).
const twoPartyAlbum = feed(`<podcast:publisher>
      <podcast:remoteItem medium="publisher" rel="artist" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" />
      <podcast:remoteItem medium="publisher" rel="label" feedGuid="label-guid" feedUrl="https://example.com/label-guid.xml" />
    </podcast:publisher>`);

const roundTrip = (xml: string) => publisherParties(parseRssFeed(generateRssFeed(parseRssFeed(xml))));

describe('publisherParties', () => {
  it('is empty for an album that names no publisher', () => {
    expect(publisherParties(createEmptyAlbum())).toEqual([]);
  });

  it('gives the primary party first, then the others in order', () => {
    expect(
      publisherParties({ publisher: party('a'), additionalPublishers: [party('b'), party('c')] })
    ).toEqual([party('a'), party('b'), party('c')]);
  });

  it('leaves out a primary with neither a GUID nor a URL (a cleared field)', () => {
    expect(
      publisherParties({ publisher: { feedGuid: '', feedUrl: '' }, additionalPublishers: [party('b')] })
    ).toEqual([party('b')]);
  });

  it('splits a list back into the two fields', () => {
    expect(fromParties([party('a')])).toEqual({ publisher: party('a'), additionalPublishers: undefined });
    expect(fromParties([party('a'), party('b')])).toEqual({
      publisher: party('a'),
      additionalPublishers: [party('b')],
    });
  });
});

describe('sameGuid', () => {
  it('ignores case and edge whitespace, and never matches two empty GUIDs', () => {
    expect(sameGuid(' ABC ', 'abc')).toBe(true);
    expect(sameGuid('', '')).toBe(false);
    expect(sameGuid(undefined, undefined)).toBe(false);
  });
});

describe('samePublisher', () => {
  it('matches on feedGuid when both have one, in any letter case', () => {
    expect(samePublisher(party('a'), { feedGuid: 'A' })).toBe(true);
    expect(samePublisher(party('a'), party('b'))).toBe(false);
  });

  it('does not match on the URL when both GUIDs differ', () => {
    expect(samePublisher(party('a'), { feedGuid: 'b', feedUrl: party('a').feedUrl })).toBe(false);
  });

  it('matches on feedUrl when a feedGuid is missing, ignoring case and edge whitespace', () => {
    expect(samePublisher({ feedGuid: '', feedUrl: ' HTTPS://example.com/a.xml ' }, party('a'))).toBe(true);
    expect(samePublisher({ feedGuid: '' }, { feedGuid: '' })).toBe(false);
  });
});

describe('linkPublisher', () => {
  it('makes the party primary when the album names none', () => {
    expect(linkPublisher({}, party('label', 'label'))).toEqual({
      publisher: party('label', 'label'),
      additionalPublishers: undefined,
    });
  });

  it('updates the same publisher in place, keeps its position and every other party', () => {
    const album = { publisher: party('artist', 'artist'), additionalPublishers: [party('LABEL')] };
    expect(linkPublisher(album, party('label', 'label'))).toEqual({
      publisher: party('artist', 'artist'),
      additionalPublishers: [party('label', 'label')],
    });
  });

  it('replaces a primary that names only a URL, which may be an older address of this publisher', () => {
    const album = { publisher: { feedGuid: '', feedUrl: 'https://old.example.com/feed.xml' } };
    expect(linkPublisher(album, party('label', 'label'))).toEqual({
      publisher: party('label', 'label'),
      additionalPublishers: undefined,
    });
  });

  it('adds the party after an album that names another publisher by GUID', () => {
    // The catalog flows check for this case first (another publisher's claim).
    expect(linkPublisher({ publisher: party('artist', 'artist') }, party('label', 'label'))).toEqual({
      publisher: party('artist', 'artist'),
      additionalPublishers: [party('label', 'label')],
    });
  });
});

describe('withPartyGuid', () => {
  it('sets the GUID on the party at that URL and keeps its rel', () => {
    const album = { publisher: { feedGuid: '', feedUrl: 'https://example.com/a.xml', rel: 'artist' } };
    expect(withPartyGuid(album, 'https://example.com/a.xml', 'a')).toEqual({
      publisher: party('a', 'artist'),
      additionalPublishers: undefined,
    });
  });

  it('finds the party wherever it is now, so a late lookup lands after a reorder', () => {
    // A lookup started for the primary; the user made another party primary
    // meanwhile, which moved the looked-up one into the others.
    const album = { publisher: party('b'), additionalPublishers: [{ feedGuid: '', feedUrl: 'https://example.com/a.xml' }] };
    expect(withPartyGuid(album, 'https://example.com/a.xml', 'a')).toEqual({
      publisher: party('b'),
      additionalPublishers: [party('a')],
    });
  });

  it('changes nothing when no party is at that URL any more, or it already has the GUID', () => {
    expect(withPartyGuid({ publisher: party('b') }, 'https://example.com/a.xml', 'a')).toBeNull();
    expect(withPartyGuid({ publisher: party('a') }, 'https://example.com/a.xml', 'a')).toBeNull();
    expect(withPartyGuid({ publisher: party('a') }, '', 'a')).toBeNull();
  });
});

describe('several parties in <podcast:publisher>', () => {
  it('keeps every party of a third-party album through a parse/regenerate cycle', () => {
    // Download Feed and processCatalogFeed are parse→regenerate over someone
    // else's feed. Before this change, only the first party survived.
    const album = parseRssFeed(twoPartyAlbum);
    expect(publisherParties(album)).toEqual([party('artist-guid', 'artist'), party('label-guid', 'label')]);
    expect(roundTrip(twoPartyAlbum)).toEqual([party('artist-guid', 'artist'), party('label-guid', 'label')]);
  });

  it('writes the parties inside one <podcast:publisher>, primary first', () => {
    const album = createEmptyAlbum();
    album.title = 'Drift';
    album.publisher = party('artist-guid', 'artist');
    album.additionalPublishers = [party('label-guid', 'label')];

    const xml = generateRssFeed(album);
    expect(xml).toContain([
      '        <podcast:publisher>',
      '            <podcast:remoteItem medium="publisher" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" rel="artist" />',
      '            <podcast:remoteItem medium="publisher" feedGuid="label-guid" feedUrl="https://example.com/label-guid.xml" rel="label" />',
      '        </podcast:publisher>',
    ].join('\n'));
  });

  it('writes one party exactly as before parties existed', () => {
    const album = createEmptyAlbum();
    album.title = 'Drift';
    album.publisher = party('artist-guid', 'artist');
    expect(generateRssFeed(album)).toContain([
      '        <podcast:publisher>',
      '            <podcast:remoteItem medium="publisher" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" rel="artist" />',
      '        </podcast:publisher>',
    ].join('\n'));
  });

  it('writes the first other party first when the primary field was cleared', () => {
    const album = createEmptyAlbum();
    album.title = 'Drift';
    album.publisher = { feedGuid: '', feedUrl: '' };
    album.additionalPublishers = [party('label-guid')];
    const xml = generateRssFeed(album);
    expect(xml.match(/<podcast:remoteItem medium="publisher"/g)).toHaveLength(1);
    expect(xml).toContain('feedGuid="label-guid"');
  });

  it('keeps every bare channel-level publisher item, which used to keep only the first', () => {
    const xml = feed(`<podcast:remoteItem medium="publisher" rel="artist" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" />
    <podcast:remoteItem medium="publisher" rel="label" feedGuid="label-guid" feedUrl="https://example.com/label-guid.xml" />
    <podcast:remoteItem medium="music" feedGuid="podroll-guid" />`);
    const album = parseRssFeed(xml);
    expect(publisherParties(album)).toEqual([party('artist-guid', 'artist'), party('label-guid', 'label')]);

    const out = generateRssFeed(album);
    expect(out.match(/<podcast:publisher>/g)).toHaveLength(1);
    expect(out.match(/medium="publisher"/g)).toHaveLength(2);
    // The podroll entry still round-trips on its own.
    expect(out).toContain('podroll-guid');
  });

  it('adds a bare publisher item after the wrapper, unless it names a party already read', () => {
    const xml = feed(`<podcast:publisher>
      <podcast:remoteItem medium="publisher" rel="artist" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" />
    </podcast:publisher>
    <podcast:remoteItem medium="publisher" feedGuid="ARTIST-GUID" />
    <podcast:remoteItem medium="publisher" rel="label" feedGuid="label-guid" feedUrl="https://example.com/label-guid.xml" />`);
    expect(roundTrip(xml)).toEqual([party('artist-guid', 'artist'), party('label-guid', 'label')]);
  });

  it('does not turn an item of another medium inside the wrapper into a publisher', () => {
    const xml = feed(`<podcast:publisher>
      <podcast:remoteItem medium="publisher" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" />
      <podcast:remoteItem medium="music" feedGuid="album-guid" />
    </podcast:publisher>`);
    expect(roundTrip(xml)).toEqual([party('artist-guid')]);
  });

  it('still reads a lone item of another medium, as before parties existed', () => {
    const xml = feed(`<podcast:publisher>
      <podcast:remoteItem medium="music" feedGuid="artist-guid" feedUrl="https://example.com/artist-guid.xml" />
    </podcast:publisher>`);
    expect(roundTrip(xml)).toEqual([party('artist-guid')]);
  });

  it('a publish by the label keeps the artist that the album already names as a party', () => {
    // The flow that publishPublisherFeed and Download Catalog run for each album.
    const album = parseRssFeed(twoPartyAlbum);
    Object.assign(album, linkPublisher(album, party('label-guid', 'producer')));
    expect(publisherParties(parseRssFeed(generateRssFeed(album)))).toEqual([
      party('artist-guid', 'artist'),
      party('label-guid', 'producer'),
    ]);
  });
});
