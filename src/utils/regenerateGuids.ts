import type { Album } from '../types/feed';

/**
 * Return a copy of an album/video feed with a fresh feed-level GUID and a fresh
 * GUID for every track.
 *
 * Used by the template/"duplicate this feed" flow so a newly created feed never
 * inherits another feed's track identities. Reusing a track's `<guid>` across two
 * different feeds makes podcast apps and Podcast Index treat unrelated tracks as
 * the same episode (the bug that produced the Live at Rockpile / Amnesia collision).
 *
 * Does not mutate the input. Publisher feeds are handled separately — their
 * `remoteItems` reference real external feeds, so only the feed GUID is renewed.
 */
export function regenerateAlbumGuids(album: Album): Album {
  return {
    ...album,
    podcastGuid: crypto.randomUUID(),
    tracks: album.tracks.map((track) => ({ ...track, guid: crypto.randomUUID() })),
  };
}
