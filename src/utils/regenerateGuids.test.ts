import { describe, it, expect } from 'vitest';
import { regenerateAlbumGuids, withoutIdentityPassthrough } from './regenerateGuids';
import { createEmptyAlbum, createEmptyTrack, type Album } from '../types/feed';

function sourceAlbum(): Album {
  const album = createEmptyAlbum();
  album.title = 'Source Album';
  album.podcastGuid = 'original-feed-guid';
  album.tracks = [
    { ...createEmptyTrack(1), guid: 'shared-guid-1', title: 'One' },
    { ...createEmptyTrack(2), guid: 'shared-guid-2', title: 'Two' },
    { ...createEmptyTrack(3), guid: 'shared-guid-3', title: 'Three' },
  ];
  return album;
}

describe('regenerateAlbumGuids', () => {
  it('replaces the feed-level podcastGuid', () => {
    const src = sourceAlbum();
    const out = regenerateAlbumGuids(src);
    expect(out.podcastGuid).not.toBe('original-feed-guid');
    expect(out.podcastGuid).toMatch(/[0-9a-f-]{36}/);
  });

  it('gives every track a fresh, unique guid', () => {
    const src = sourceAlbum();
    const out = regenerateAlbumGuids(src);
    const newGuids = out.tracks.map((t) => t.guid);
    // none kept the original guid
    expect(newGuids).not.toContain('shared-guid-1');
    expect(newGuids).not.toContain('shared-guid-2');
    expect(newGuids).not.toContain('shared-guid-3');
    // all unique
    expect(new Set(newGuids).size).toBe(newGuids.length);
  });

  it('preserves non-guid track data and order', () => {
    const out = regenerateAlbumGuids(sourceAlbum());
    expect(out.title).toBe('Source Album');
    expect(out.tracks.map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('does not mutate the input', () => {
    const src = sourceAlbum();
    regenerateAlbumGuids(src);
    expect(src.podcastGuid).toBe('original-feed-guid');
    expect(src.tracks.map((t) => t.guid)).toEqual(['shared-guid-1', 'shared-guid-2', 'shared-guid-3']);
  });

  it('produces different guids on each call (two duplicates never collide)', () => {
    const src = sourceAlbum();
    const a = regenerateAlbumGuids(src);
    const b = regenerateAlbumGuids(src);
    expect(a.podcastGuid).not.toBe(b.podcastGuid);
    const overlap = a.tracks.map((t) => t.guid).filter((g) => b.tracks.some((t) => t.guid === g));
    expect(overlap).toEqual([]);
  });

  it('drops the source feed\'s identity passthrough but keeps the rest', () => {
    const src = sourceAlbum();
    src.unknownChannelElements = {
      'podcast:txt': { '#text': 'abc-123', '@_purpose': 'applepodcastsverify' },
      'atom:link': [
        { '@_rel': 'self', '@_href': 'https://source.example/feed.xml' },
        { '@_rel': 'hub', '@_href': 'https://pubsubhubbub.example' }
      ],
      'content:encoded': 'notes'
    };
    expect(regenerateAlbumGuids(src).unknownChannelElements).toEqual({
      'atom:link': { '@_rel': 'hub', '@_href': 'https://pubsubhubbub.example' },
      'content:encoded': 'notes'
    });
    expect(src.unknownChannelElements['podcast:txt']).toBeDefined();
  });

  it('returns undefined when only identity passthrough was there', () => {
    expect(withoutIdentityPassthrough({ 'podcast:txt': { '#text': 'x' } })).toBeUndefined();
    expect(withoutIdentityPassthrough(undefined)).toBeUndefined();
  });
});
