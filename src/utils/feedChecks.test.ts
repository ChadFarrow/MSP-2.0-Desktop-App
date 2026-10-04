import { describe, it, expect } from 'vitest';
import {
  getSaveBlockers,
  formatSaveBlockers,
  getShouldFixIssues,
  isUuidGuid,
  issueLocationLabel,
  type FeedSnapshot,
  type SaveTarget
} from './feedChecks';
import { createEmptyAlbum, createEmptyVideoAlbum, createEmptyPublisherFeed, createEmptyTrack } from '../types/feed';
import type { Album, PublisherFeed, Track, ValueRecipient } from '../types/feed';
import { getValueRecipientErrors } from './valueValidation';

const UUID = 'c7d1b2a0-1111-4222-8333-444455556666';

/**
 * A verbatim copy of the inline block SaveModal.handleSave carried before the
 * rules moved to feedChecks.ts. Pinned here so the move can be proven to change
 * nothing for the existing targets.
 */
function legacyErrors(album: Album, publisherFeed: PublisherFeed | null, feedType: string, mode: string): string[] {
  const isPublisherMode = feedType === 'publisher';
  const isVideoMode = feedType === 'video';
  const errors: string[] = [];
  if (isPublisherMode && publisherFeed) {
    if (!publisherFeed.author?.trim()) errors.push('Artist Name');
    if (!publisherFeed.title?.trim()) errors.push('Catalog Title');
    if (!publisherFeed.description?.trim()) errors.push('Description');
    if (!publisherFeed.podcastGuid?.trim()) errors.push('Publisher GUID');
    errors.push(...getValueRecipientErrors(publisherFeed.value?.recipients, 'Value recipient'));
  } else {
    const isNostrMusicMode = mode === 'nostrMusic';
    if (!album.author?.trim()) errors.push('Artist/Band');
    if (!album.title?.trim()) errors.push('Album Title');
    if (!isNostrMusicMode && !album.description?.trim()) errors.push('Description');
    if (!album.imageUrl?.trim()) errors.push('Album Art URL');
    if (!album.language?.trim()) errors.push('Language');
    if (!album.podcastGuid?.trim()) errors.push('Podcast GUID');
    errors.push(...getValueRecipientErrors(album.value?.recipients, 'Value recipient'));
    const itemLabel = isVideoMode ? 'Video' : 'Track';
    const urlLabel = isVideoMode ? 'Video URL' : 'MP3 URL';
    album.tracks.forEach((track, i) => {
      if (!track.title?.trim()) errors.push(`${itemLabel} ${i + 1} Title`);
      if (!isNostrMusicMode && !track.duration?.trim()) errors.push(`${itemLabel} ${i + 1} Duration`);
      if (!track.enclosureUrl?.trim()) errors.push(`${itemLabel} ${i + 1} ${urlLabel}`);
      if (!isNostrMusicMode && !track.enclosureLength?.trim()) errors.push(`${itemLabel} ${i + 1} File Size`);
      errors.push(...getValueRecipientErrors(track.value?.recipients, `${itemLabel} ${i + 1} value recipient`));
    });
  }
  return errors;
}

const recipient = (partial: Partial<ValueRecipient>): ValueRecipient => ({
  name: 'Artist', address: 'artist@getalby.com', split: 90, type: 'lnaddress', ...partial
});

const track = (partial: Partial<Track> = {}, n = 1): Track => ({
  ...createEmptyTrack(n),
  title: `Song ${n}`,
  duration: '00:03:45',
  enclosureUrl: `https://example.com/${n}.mp3`,
  enclosureLength: '3600000',
  ...partial
});

// A feed that passes every check.
const goodAlbum = (): Album => ({
  ...createEmptyAlbum(),
  author: 'Artist',
  title: 'Album',
  description: 'About it',
  link: 'https://artist.example',
  imageUrl: 'https://example.com/art.jpg',
  language: 'en',
  podcastGuid: UUID,
  value: { type: 'lightning', method: 'keysend', recipients: [recipient({})] },
  tracks: [
    track({ pubDate: 'Sat, 01 Feb 2025 00:02:00 GMT' }, 1),
    track({ pubDate: 'Sat, 01 Feb 2025 00:01:00 GMT' }, 2)
  ]
});

const albumFeed = (album: Album, feedType: 'album' | 'video' = 'album'): FeedSnapshot => ({ feedType, album, publisherFeed: null });

const publisherFeedSnapshot = (publisher: PublisherFeed): FeedSnapshot => ({
  feedType: 'publisher', album: createEmptyAlbum(), publisherFeed: publisher
});

const goodPublisher = (): PublisherFeed => ({
  ...createEmptyPublisherFeed(),
  author: 'Label',
  title: 'Catalog',
  description: 'About the label',
  link: 'https://label.example',
  podcastGuid: UUID,
  value: { type: 'lightning', method: 'keysend', recipients: [recipient({ name: 'Label' })] }
});

const codes = (issues: { code: string }[]) => issues.map(issue => issue.code);
const labels = (feed: FeedSnapshot, target: SaveTarget) =>
  getSaveBlockers(feed, target).map(issue => issue.saveLabel);

describe('getSaveBlockers parity with the old SaveModal gate', () => {
  const brokenAlbum = (): Album => ({
    ...createEmptyAlbum(),
    language: '',
    value: { type: 'lightning', method: 'keysend', recipients: [recipient({ split: 0, name: 'Zero' })] },
    tracks: [
      { ...createEmptyTrack(1), duration: '' },
      track({ value: { type: 'lightning', method: 'keysend', recipients: [recipient({ split: NaN, name: '' , address: 'x@y.z' })] } }, 2)
    ]
  });

  const fixtures: [string, FeedSnapshot][] = [
    ['empty album', albumFeed(createEmptyAlbum())],
    ['broken album', albumFeed(brokenAlbum())],
    ['good album', albumFeed(goodAlbum())],
    ['broken video', albumFeed({ ...createEmptyVideoAlbum(), tracks: [{ ...createEmptyTrack(1), duration: '' }] }, 'video')],
    ['empty publisher', publisherFeedSnapshot({ ...createEmptyPublisherFeed(), podcastGuid: '' })],
    ['publisher with a zero split', publisherFeedSnapshot({
      ...goodPublisher(),
      value: { type: 'lightning', method: 'keysend', recipients: [recipient({ split: 0 })] }
    })],
    ['publisher mode without a publisher feed falls back to the album rules', { feedType: 'publisher', album: brokenAlbum(), publisherFeed: null }]
  ];

  for (const [name, feed] of fixtures) {
    for (const target of ['publish', 'nostrMusic'] as const) {
      it(`${name} — ${target}`, () => {
        const legacy = legacyErrors(feed.album, feed.publisherFeed, feed.feedType, target);
        expect(labels(feed, target)).toEqual(legacy);
        if (legacy.length > 0) {
          expect(formatSaveBlockers(getSaveBlockers(feed, target))).toBe(`Missing required fields: ${legacy.join(', ')}`);
        }
      });
    }
  }

  it('reports nothing for a complete feed', () => {
    expect(getSaveBlockers(albumFeed(goodAlbum()), 'hostedCreate')).toEqual([]);
    expect(getSaveBlockers(publisherFeedSnapshot(goodPublisher()), 'hostedCreate')).toEqual([]);
  });

  it('ties track issues to the track id, not its position', () => {
    const album = goodAlbum();
    album.tracks[1].title = '';
    const [issue] = getSaveBlockers(albumFeed(album), 'publish');
    expect(issue).toMatchObject({ code: 'track-missing-title', trackId: album.tracks[1].id, saveLabel: 'Track 2 Title' });
  });
});

describe('the UUID rule for Host on MSP', () => {
  it('accepts upper- and lowercase UUIDs', () => {
    expect(isUuidGuid(UUID)).toBe(true);
    expect(isUuidGuid(UUID.toUpperCase())).toBe(true);
  });

  it('rejects anything else, including a UUID with stray spaces', () => {
    expect(isUuidGuid('my-album-1')).toBe(false);
    expect(isUuidGuid(` ${UUID}`)).toBe(false);
    expect(isUuidGuid(`${UUID} `)).toBe(false);
  });

  it('blocks only hostedCreate', () => {
    const feed = albumFeed({ ...goodAlbum(), podcastGuid: 'my-album-1' });
    expect(getSaveBlockers(feed, 'publish')).toEqual([]);
    expect(getSaveBlockers(feed, 'nostrMusic')).toEqual([]);
    expect(labels(feed, 'hostedCreate')).toEqual(['Podcast GUID (must be a UUID to host on MSP)']);
  });

  it('labels the publisher GUID as such', () => {
    const feed = publisherFeedSnapshot({ ...goodPublisher(), podcastGuid: 'label-1' });
    expect(labels(feed, 'hostedCreate')).toEqual(['Publisher GUID (must be a UUID to host on MSP)']);
  });

  it('reports an empty GUID once, as missing', () => {
    const feed = albumFeed({ ...goodAlbum(), podcastGuid: '' });
    expect(labels(feed, 'hostedCreate')).toEqual(['Podcast GUID']);
  });
});

describe('the Save targets nest', () => {
  const feeds: FeedSnapshot[] = [
    albumFeed(createEmptyAlbum()),
    albumFeed({ ...goodAlbum(), podcastGuid: 'not-a-uuid', description: '' }),
    albumFeed({ ...createEmptyVideoAlbum(), tracks: [createEmptyTrack(1)] }, 'video'),
    publisherFeedSnapshot({ ...createEmptyPublisherFeed(), podcastGuid: 'x' })
  ];

  it('nostrMusic ⊆ publish ⊆ hostedCreate', () => {
    for (const feed of feeds) {
      const nostr = labels(feed, 'nostrMusic');
      const publish = labels(feed, 'publish');
      const hosted = labels(feed, 'hostedCreate');
      expect(publish).toEqual(expect.arrayContaining(nostr));
      expect(hosted).toEqual(expect.arrayContaining(publish));
    }
  });
});

describe('getShouldFixIssues', () => {
  it('finds nothing in a healthy feed', () => {
    expect(getShouldFixIssues(albumFeed(goodAlbum()))).toEqual([]);
    expect(getShouldFixIssues(publisherFeedSnapshot(goodPublisher()))).toEqual([]);
  });

  it('flags a zero or unreadable duration, but leaves an empty one to the Save gate', () => {
    const album = goodAlbum();
    album.tracks[0].duration = '00:00:00';
    album.tracks[1].duration = '';
    const issues = getShouldFixIssues(albumFeed(album));
    expect(codes(issues)).toEqual(['duration-zero']);
    expect(issues[0].trackId).toBe(album.tracks[0].id);
  });

  it('flags the second of two tracks sharing a GUID', () => {
    const album = goodAlbum();
    album.tracks[1].guid = album.tracks[0].guid;
    const issues = getShouldFixIssues(albumFeed(album));
    expect(codes(issues)).toEqual(['guid-duplicate']);
    expect(issues[0].trackId).toBe(album.tracks[1].id);
    expect(issues[0].message).toContain('Track 1');
  });

  it('flags spaces, missing schemes and http in media URLs', () => {
    const album = goodAlbum();
    album.tracks[0].enclosureUrl = 'https://example.com/my song.mp3';
    album.tracks[1].enclosureUrl = 'example.com/2.mp3';
    album.imageUrl = 'http://example.com/art.jpg';
    expect(codes(getShouldFixIssues(albumFeed(album)))).toEqual(['url-http', 'url-whitespace', 'url-scheme']);
  });

  it('flags track art URLs too', () => {
    const album = goodAlbum();
    album.tracks[0].trackArtUrl = 'http://example.com/t.jpg';
    expect(codes(getShouldFixIssues(albumFeed(album)))).toEqual(['url-http']);
  });

  it('flags an audio type in a video feed only', () => {
    const album = goodAlbum();
    expect(getShouldFixIssues(albumFeed(album))).toEqual([]);
    expect(codes(getShouldFixIssues(albumFeed(album, 'video')))).toEqual(['video-audio-type', 'video-audio-type']);
    album.tracks.forEach(t => { t.enclosureType = 'video/mp4'; });
    expect(getShouldFixIssues(albumFeed(album, 'video'))).toEqual([]);
  });

  it('flags the non-spec application/srt lyrics type when a lyrics URL is set', () => {
    const album = goodAlbum();
    album.tracks[0].transcriptType = 'application/srt';
    expect(getShouldFixIssues(albumFeed(album))).toEqual([]);
    album.tracks[0].transcriptUrl = 'https://example.com/1.srt';
    expect(codes(getShouldFixIssues(albumFeed(album)))).toEqual(['transcript-type']);
    album.tracks[0].transcriptType = 'application/x-subrip';
    expect(getShouldFixIssues(albumFeed(album))).toEqual([]);
  });

  it('flags a missing channel link on album and publisher feeds', () => {
    expect(codes(getShouldFixIssues(albumFeed({ ...goodAlbum(), link: '' })))).toEqual(['channel-link-missing']);
    expect(codes(getShouldFixIssues(publisherFeedSnapshot({ ...goodPublisher(), link: ' ' })))).toEqual(['channel-link-missing']);
  });

  it('points at the track order banner', () => {
    const album = goodAlbum();
    album.tracks.reverse();
    const issues = getShouldFixIssues(albumFeed(album));
    expect(codes(issues)).toEqual(['track-order']);
    expect(issues[0].message).toContain('Fix pub dates');
  });

  it('never flags an empty field the Save gate already reports', () => {
    const feed = albumFeed({ ...createEmptyAlbum(), link: 'https://a.example', tracks: [{ ...createEmptyTrack(1), duration: '' }] });
    const should = getShouldFixIssues(feed);
    expect(should).toEqual([]);
  });
});

describe('issueLocationLabel', () => {
  it('names a track by its current position', () => {
    const album = goodAlbum();
    const issue = { code: 'duration-zero' as const, level: 'should' as const, area: 'tracks' as const, message: '', trackId: album.tracks[1].id };
    expect(issueLocationLabel(issue, albumFeed(album))).toBe('Track 2');
    album.tracks.reverse();
    expect(issueLocationLabel(issue, albumFeed(album))).toBe('Track 1');
    expect(issueLocationLabel(issue, albumFeed(album, 'video'))).toBe('Video 1');
  });

  it('falls back to the area when the track is gone', () => {
    const issue = { code: 'duration-zero' as const, level: 'should' as const, area: 'tracks' as const, message: '', trackId: 'gone' };
    expect(issueLocationLabel(issue, albumFeed(goodAlbum()))).toBe('Tracks');
  });

  it('names sections per feed type', () => {
    const issue = { code: 'missing-title' as const, level: 'must' as const, area: 'feed' as const, message: '' };
    expect(issueLocationLabel(issue, albumFeed(goodAlbum()))).toBe('Album Info');
    expect(issueLocationLabel(issue, albumFeed(goodAlbum(), 'video'))).toBe('Video Info');
    expect(issueLocationLabel(issue, publisherFeedSnapshot(goodPublisher()))).toBe('Publisher Info');
  });
});
