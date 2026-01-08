import type { Album, Track, ValueRecipient, ValueBlock, Person, PersonGroup } from '../types/feed';
import type { NostrMusicTrackInfo, NostrMusicAlbumGroup, NostrZapSplit, NostrEvent } from '../types/nostr';
import { createEmptyAlbum, createEmptyTrack } from '../types/feed';
import { fetchNostrProfile } from './nostrSync';
import { areValueBlocksEqual } from './comparison';
import { parseReleasedDate } from './dateUtils';

// Kind 36787 for Nostr music tracks
const MUSIC_TRACK_KIND = 36787;

// Infer person group from role string
function inferPersonGroup(role: string): PersonGroup {
  const roleLower = role.toLowerCase();

  if (/vocal|sing|voice/i.test(roleLower)) return 'music';
  if (/guitar|bass|drum|keyboard|instrument|beat/i.test(roleLower)) return 'music';
  if (/write|lyric|compos/i.test(roleLower)) return 'writing';
  if (/produc|engineer|mix|master/i.test(roleLower)) return 'audio-production';
  if (/art|design|photo|video|visual|cover/i.test(roleLower)) return 'visuals';

  return 'misc';
}

// Parse credits string into Person array
function parseCreditsToPersons(credits: string): Person[] {
  const persons: Person[] = [];
  const lines = credits.split('\n').filter(l => l.trim());

  for (const line of lines) {
    // Try to parse "Name: Role" format
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const name = line.substring(0, colonIndex).trim();
      const role = line.substring(colonIndex + 1).trim().toLowerCase();

      // Map common roles to person groups
      const group = inferPersonGroup(role);

      persons.push({
        name,
        roles: [{ group, role: role || 'contributor' }]
      });
    }
  }

  return persons;
}

// Build description from track content
function buildTrackDescription(track: NostrMusicTrackInfo): string {
  const parts: string[] = [];

  if (track.content.lyrics) {
    parts.push(track.content.lyrics);
  }

  if (track.content.license) {
    parts.push(`License: ${track.content.license}`);
  }

  return parts.join('\n\n');
}

// Convert zap splits to ValueBlock
async function buildValueBlockFromZaps(
  zaps: NostrZapSplit[],
  fetchProfiles: boolean
): Promise<ValueBlock> {
  const recipients: ValueRecipient[] = [];

  for (const zap of zaps) {
    let name = zap.pubkey.substring(0, 8) + '...';

    // Optionally fetch profile to get display name
    if (fetchProfiles) {
      try {
        const profile = await fetchNostrProfile(zap.pubkey);
        if (profile?.display_name || profile?.name) {
          name = profile.display_name || profile.name || name;
        }
      } catch {
        // Use truncated pubkey as fallback
      }
    }

    recipients.push({
      name,
      address: zap.pubkey,
      split: zap.splitPercentage,
      type: 'node',
      customKey: '696969',
      customValue: zap.pubkey
    });
  }

  return {
    type: 'lightning',
    method: 'keysend',
    suggested: '0.000033333',
    recipients
  };
}

// Build aggregate value block from all tracks' zap splits
async function buildAggregateValueBlock(
  tracks: NostrMusicTrackInfo[],
  fetchProfiles: boolean
): Promise<ValueBlock> {
  // Collect all unique zap recipients across tracks
  const zapMap = new Map<string, NostrZapSplit>();

  for (const track of tracks) {
    for (const zap of track.zapSplits) {
      if (!zapMap.has(zap.pubkey)) {
        zapMap.set(zap.pubkey, zap);
      }
    }
  }

  const allZaps = Array.from(zapMap.values());
  return buildValueBlockFromZaps(allZaps, fetchProfiles);
}

// Convert individual NostrMusicTrackInfo to Track
async function convertNostrTrackToTrack(
  nostrTrack: NostrMusicTrackInfo,
  fallbackNumber: number,
  albumValueBlock: ValueBlock,
  fetchProfiles: boolean
): Promise<Track> {
  const track = createEmptyTrack(nostrTrack.trackNumber || fallbackNumber);

  track.title = nostrTrack.title;
  track.enclosureUrl = nostrTrack.url;
  track.trackNumber = nostrTrack.trackNumber || fallbackNumber;
  track.guid = nostrTrack.dTag;

  // Build description from content
  track.description = buildTrackDescription(nostrTrack);

  // Set track art
  if (nostrTrack.imageUrl) {
    track.trackArtUrl = nostrTrack.imageUrl;
  }

  // Parse release date
  if (nostrTrack.released) {
    track.pubDate = parseReleasedDate(nostrTrack.released);
  }

  // Build track-specific value block if different from album
  if (nostrTrack.zapSplits.length > 0) {
    const trackValue = await buildValueBlockFromZaps(nostrTrack.zapSplits, fetchProfiles);

    // Check if different from album value block
    if (!areValueBlocksEqual(trackValue, albumValueBlock)) {
      track.value = trackValue;
      track.overrideValue = true;
    }
  }

  // Parse credits into persons if available
  if (nostrTrack.content.credits) {
    track.persons = parseCreditsToPersons(nostrTrack.content.credits);
    track.overridePersons = track.persons.length > 0;
  }

  return track;
}

// Convert NostrMusicAlbumGroup to Album type
export async function convertNostrMusicToAlbum(
  albumGroup: NostrMusicAlbumGroup,
  fetchProfiles = true
): Promise<Album> {
  const album = createEmptyAlbum();

  // Album-level fields
  album.title = albumGroup.albumName;
  album.author = albumGroup.artist;
  album.imageUrl = albumGroup.imageUrl || '';
  album.imageTitle = albumGroup.albumName;

  // Infer description from first track with content
  const trackWithDesc = albumGroup.tracks.find(t => t.content.lyrics || t.content.credits);
  if (trackWithDesc?.content.credits) {
    album.description = `Credits: ${trackWithDesc.content.credits}`;
  }

  // Set language from first track
  const trackWithLang = albumGroup.tracks.find(t => t.language);
  if (trackWithLang) {
    album.language = trackWithLang.language || 'en';
  }

  // Collect all unique genres as categories
  const allGenres = new Set<string>();
  for (const track of albumGroup.tracks) {
    track.genres.forEach(g => allGenres.add(g));
  }
  album.categories = Array.from(allGenres).slice(0, 5);

  // Build aggregate value block from all zap splits
  const aggregateValueBlock = await buildAggregateValueBlock(
    albumGroup.tracks,
    fetchProfiles
  );
  if (aggregateValueBlock.recipients.length > 0) {
    album.value = aggregateValueBlock;
  }

  // Convert tracks
  album.tracks = await Promise.all(
    albumGroup.tracks.map((track, index) =>
      convertNostrTrackToTrack(track, index + 1, aggregateValueBlock, fetchProfiles)
    )
  );

  return album;
}

// Parse content field for lyrics, credits, license
function parseNostrMusicContent(content: string): { lyrics?: string; credits?: string; license?: string } {
  const result: { lyrics?: string; credits?: string; license?: string } = {};

  if (!content || !content.trim()) return result;

  // Split by known section headers
  const sections = content.split(/\n\n(?=Lyrics:|Credits:|License:)/i);

  for (const section of sections) {
    const trimmed = section.trim();

    if (trimmed.toLowerCase().startsWith('lyrics:')) {
      result.lyrics = trimmed.substring(7).trim();
    } else if (trimmed.toLowerCase().startsWith('credits:')) {
      result.credits = trimmed.substring(8).trim();
    } else if (trimmed.toLowerCase().startsWith('license:')) {
      result.license = trimmed.substring(8).trim();
    } else if (!result.lyrics && trimmed) {
      // If no section header and no lyrics yet, treat as lyrics
      result.lyrics = trimmed;
    }
  }

  return result;
}

// Parse a raw kind 36787 Nostr event into NostrMusicTrackInfo
function parseNostrMusicEvent(event: NostrEvent): NostrMusicTrackInfo | null {
  const getTag = (name: string): string | undefined =>
    event.tags.find(t => t[0] === name)?.[1];

  const dTag = getTag('d');
  const title = getTag('title');
  const url = getTag('url');

  // Required fields
  if (!dTag || !title || !url) return null;

  // Parse genres from 't' tags
  const genres = event.tags
    .filter(t => t[0] === 't')
    .map(t => t[1])
    .filter(Boolean);

  // Parse zap splits from 'zap' tags
  const zapSplits: NostrZapSplit[] = event.tags
    .filter(t => t[0] === 'zap')
    .map(t => ({
      pubkey: t[1] || '',
      relay: t[2] || undefined,
      splitPercentage: parseInt(t[3]) || 0
    }))
    .filter(z => z.pubkey && z.splitPercentage > 0);

  // Parse content for lyrics, credits, license
  const parsedContent = parseNostrMusicContent(event.content);

  return {
    id: event.id || '',
    dTag,
    title,
    artist: getTag('artist') || 'Unknown Artist',
    album: getTag('album') || 'Singles',
    trackNumber: parseInt(getTag('track_number') || '1') || 1,
    url,
    imageUrl: getTag('image'),
    released: getTag('released'),
    language: getTag('language'),
    genres,
    zapSplits,
    content: parsedContent,
    createdAt: event.created_at
  };
}

// Parse raw Nostr event JSON and convert to Album
export async function parseNostrEventJson(
  jsonString: string,
  fetchProfiles = true
): Promise<Album> {
  let event: NostrEvent;

  try {
    event = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON format');
  }

  // Validate it's a music track event
  if (event.kind !== MUSIC_TRACK_KIND) {
    throw new Error(`Invalid event kind: expected ${MUSIC_TRACK_KIND}, got ${event.kind}`);
  }

  const trackInfo = parseNostrMusicEvent(event);
  if (!trackInfo) {
    throw new Error('Failed to parse music track event: missing required tags (d, title, url)');
  }

  // Create an album group with a single track
  const albumGroup: NostrMusicAlbumGroup = {
    albumName: trackInfo.album,
    artist: trackInfo.artist,
    imageUrl: trackInfo.imageUrl,
    tracks: [trackInfo]
  };

  return convertNostrMusicToAlbum(albumGroup, fetchProfiles);
}
