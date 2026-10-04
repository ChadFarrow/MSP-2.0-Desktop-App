import type { Album } from '../types/feed';

/**
 * Drop the passthrough elements that claim a feed's identity: every
 * `<podcast:txt>` (verification tokens such as applepodcastsverify name one
 * specific feed) and an `<atom:link rel="self">` URL. A template is a new feed,
 * so it must not carry the source's. Other passthrough elements are kept.
 *
 * Does not mutate the input; returns undefined once nothing is left, matching
 * the parser's own passthrough maps.
 */
export function withoutIdentityPassthrough(
  elements: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!elements) return elements;
  const rest = { ...elements };
  delete rest['podcast:txt'];
  const links = rest['atom:link'];
  if (links) {
    const kept = (Array.isArray(links) ? links : [links]).filter(
      link => !(typeof link === 'object' && link !== null && (link as Record<string, unknown>)['@_rel'] === 'self')
    );
    if (kept.length === 0) delete rest['atom:link'];
    else rest['atom:link'] = kept.length === 1 ? kept[0] : kept;
  }
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Return a copy of an album/video feed with a fresh feed-level GUID and a fresh
 * GUID for every track.
 *
 * Used by the template/"duplicate this feed" flow so a newly created feed never
 * inherits another feed's track identities. Reusing a track's `<guid>` across two
 * different feeds makes podcast apps and Podcast Index treat unrelated tracks as
 * the same episode (the bug that produced the Live at Rockpile / Amnesia collision).
 * The source's identity passthrough (verification txt tags, self link) goes too.
 *
 * Does not mutate the input. Publisher feeds are handled separately — their
 * `remoteItems` reference real external feeds, so only the feed GUID is renewed.
 */
export function regenerateAlbumGuids(album: Album): Album {
  return {
    ...album,
    podcastGuid: crypto.randomUUID(),
    unknownChannelElements: withoutIdentityPassthrough(album.unknownChannelElements),
    tracks: album.tracks.map((track) => ({ ...track, guid: crypto.randomUUID() })),
  };
}
