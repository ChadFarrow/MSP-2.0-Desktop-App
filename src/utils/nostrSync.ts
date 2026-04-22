import type { Album, Track, Person, ValueRecipient, PublisherFeed } from '../types/feed';
import type { NostrEvent, SavedAlbumInfo, NostrMusicTrackInfo, NostrMusicAlbumGroup, PublishedTrackRef } from '../types/nostr';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { parseRssFeed } from './xmlParser';
import { formatReleasedDate } from './dateUtils';
import {
  DEFAULT_RELAYS,
  MUSIC_RELAYS,
  connectRelay,
  collectEvents,
  publishEventToRelays
} from './nostrRelay';
import { getSigner, hasSigner } from './nostrSigner';
import { parseNostrMusicEvent } from './nostrMusicConverter';

// Re-export for backward compatibility
export { DEFAULT_RELAYS, MUSIC_RELAYS };

// Re-export Blossom functions from dedicated module
export { uploadToBlossom } from './blossom';

// Kind 30054 for podcast/RSS feeds (parameterized replaceable)
const RSS_FEED_KIND = 30054;
const CLIENT_TAG = 'MSP 2.0';

// Kind 36787 for Nostr music tracks
const MUSIC_TRACK_KIND = 36787;

// Kind 34139 for Nostr music playlists
const MUSIC_PLAYLIST_KIND = 34139;

// Kind 5 for NIP-09 deletion requests
const DELETION_KIND = 5;

// Nostr profile metadata interface
export interface NostrProfile {
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

// Fetch user profile (kind 0) from relays
export async function fetchNostrProfile(
  pubkey: string,
  relays = DEFAULT_RELAYS
): Promise<NostrProfile | null> {
  try {
    let latestEvent: NostrEvent | null = null;

    const results = await Promise.allSettled(
      relays.map(async (relayUrl) => {
        const ws = await connectRelay(relayUrl, 3000);
        try {
          const subId = Math.random().toString(36).substring(7);
          const filter = {
            kinds: [0],
            authors: [pubkey],
            limit: 1
          };

          ws.send(JSON.stringify(['REQ', subId, filter]));
          const events = await collectEvents(ws, subId, 3000);
          return events;
        } finally {
          ws.close();
        }
      })
    );

    // Find the latest profile event
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const event of result.value) {
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        }
      }
    }

    if (latestEvent && latestEvent.content) {
      return JSON.parse(latestEvent.content) as NostrProfile;
    }

    return null;
  } catch {
    return null;
  }
}

// Create an unsigned event for an RSS feed
function createFeedEvent(rssXml: string, podcastGuid: string, title: string, pubkey: string): NostrEvent {
  return {
    kind: RSS_FEED_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', podcastGuid],
      ['title', title || 'Untitled Album'],
      ['client', CLIENT_TAG]
    ],
    content: rssXml
  };
}

// Save album to Nostr relays
export async function saveAlbumToNostr(
  album: Album,
  hasChanges = true,
  relays = DEFAULT_RELAYS
): Promise<{ success: boolean; message: string }> {
  if (!hasSigner()) {
    return { success: false, message: 'Not logged in' };
  }

  try {
    const signer = getSigner();
    // Get public key
    const pubkey = await signer.getPublicKey();

    // Only update lastBuildDate if there are actual changes
    const updatedAlbum = hasChanges
      ? { ...album, lastBuildDate: new Date().toUTCString() }
      : album;

    // Generate RSS XML from album
    const rssXml = generateRssFeed(updatedAlbum);

    // Create and sign the event
    const unsignedEvent = createFeedEvent(rssXml, album.podcastGuid, album.title, pubkey);
    const signedEvent = await signer.signEvent(unsignedEvent);

    // Publish to relays
    const { successCount } = await publishEventToRelays(signedEvent as NostrEvent, relays);

    if (successCount === 0) {
      return { success: false, message: 'Failed to publish to any relay' };
    }

    return {
      success: true,
      message: `Published to ${successCount}/${relays.length} relays`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}

// Generic save feed to Nostr - works with both album and publisher feeds
export async function saveFeedToNostr(
  feed: Album | PublisherFeed,
  feedType: 'album' | 'publisher',
  hasChanges = true,
  relays = DEFAULT_RELAYS
): Promise<{ success: boolean; message: string }> {
  if (!hasSigner()) {
    return { success: false, message: 'Not logged in' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();

    // Generate RSS XML based on feed type
    let rssXml: string;
    let feedGuid: string;
    let feedTitle: string;

    if (feedType === 'publisher') {
      const publisherFeed = feed as PublisherFeed;
      const updatedFeed = hasChanges
        ? { ...publisherFeed, lastBuildDate: new Date().toUTCString() }
        : publisherFeed;
      rssXml = generatePublisherRssFeed(updatedFeed);
      feedGuid = publisherFeed.podcastGuid;
      feedTitle = publisherFeed.title;
    } else {
      const album = feed as Album;
      const updatedAlbum = hasChanges
        ? { ...album, lastBuildDate: new Date().toUTCString() }
        : album;
      rssXml = generateRssFeed(updatedAlbum);
      feedGuid = album.podcastGuid;
      feedTitle = album.title;
    }

    // Create and sign the event
    const unsignedEvent = createFeedEvent(rssXml, feedGuid, feedTitle, pubkey);
    const signedEvent = await signer.signEvent(unsignedEvent);

    // Publish to relays
    const { successCount } = await publishEventToRelays(signedEvent as NostrEvent, relays);

    if (successCount === 0) {
      return { success: false, message: 'Failed to publish to any relay' };
    }

    return {
      success: true,
      message: `Published to ${successCount}/${relays.length} relays`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}

// Load saved albums from Nostr relays
export async function loadAlbumsFromNostr(
  relays = DEFAULT_RELAYS
): Promise<{ success: boolean; albums: SavedAlbumInfo[]; message: string }> {
  if (!hasSigner()) {
    return { success: false, albums: [], message: 'Not logged in' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();
    const allEvents: NostrEvent[] = [];

    // Query each relay
    const results = await Promise.allSettled(
      relays.map(async (relayUrl) => {
        const ws = await connectRelay(relayUrl);
        try {
          const subId = Math.random().toString(36).substring(7);
          const filter = {
            kinds: [RSS_FEED_KIND],
            authors: [pubkey]
          };

          ws.send(JSON.stringify(['REQ', subId, filter]));
          const events = await collectEvents(ws, subId);
          return events;
        } finally {
          ws.close();
        }
      })
    );

    // Collect all events from successful relays
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEvents.push(...result.value);
      }
    }

    // Deduplicate by event id and filter by client tag
    const uniqueEvents = new Map<string, NostrEvent>();
    for (const event of allEvents) {
      const clientTag = event.tags.find(t => t[0] === 'client')?.[1];
      if (event.id && !uniqueEvents.has(event.id) && clientTag === CLIENT_TAG) {
        uniqueEvents.set(event.id, event);
      }
    }

    // Convert to SavedAlbumInfo
    const albums: SavedAlbumInfo[] = [];
    for (const event of uniqueEvents.values()) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
      const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Untitled';

      albums.push({
        id: event.id || '',
        dTag,
        title,
        createdAt: event.created_at,
        pubkey: event.pubkey || ''
      });
    }

    // Sort by creation date (newest first)
    albums.sort((a, b) => b.createdAt - a.createdAt);

    return {
      success: true,
      albums,
      message: `Found ${albums.length} album(s)`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, albums: [], message };
  }
}

// Load a specific album by d tag
export async function loadAlbumByDTag(
  dTag: string,
  relays = DEFAULT_RELAYS
): Promise<{ success: boolean; album: Album | null; message: string }> {
  if (!hasSigner()) {
    return { success: false, album: null, message: 'Not logged in' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();
    let latestEvent: NostrEvent | null = null;

    // Query each relay
    const results = await Promise.allSettled(
      relays.map(async (relayUrl) => {
        const ws = await connectRelay(relayUrl);
        try {
          const subId = Math.random().toString(36).substring(7);
          const filter = {
            kinds: [RSS_FEED_KIND],
            authors: [pubkey],
            '#d': [dTag]
          };

          ws.send(JSON.stringify(['REQ', subId, filter]));
          const events = await collectEvents(ws, subId);
          return events;
        } finally {
          ws.close();
        }
      })
    );

    // Find the latest event
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const event of result.value) {
          if (!latestEvent || event.created_at > latestEvent.created_at) {
            latestEvent = event;
          }
        }
      }
    }

    if (!latestEvent) {
      return { success: false, album: null, message: 'Album not found' };
    }

    // Parse the RSS XML content back to Album
    const album = parseRssFeed(latestEvent.content);
    return { success: true, album, message: 'Album loaded successfully' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, album: null, message };
  }
}

// Group tracks by album for UI display
export function groupTracksByAlbum(tracks: NostrMusicTrackInfo[]): NostrMusicAlbumGroup[] {
  const albumMap = new Map<string, NostrMusicAlbumGroup>();

  for (const track of tracks) {
    const key = `${track.album}|${track.artist}`;

    if (!albumMap.has(key)) {
      albumMap.set(key, {
        albumName: track.album,
        artist: track.artist,
        imageUrl: track.imageUrl,
        tracks: []
      });
    }

    const group = albumMap.get(key)!;
    group.tracks.push(track);

    // Use first track with image as album image
    if (!group.imageUrl && track.imageUrl) {
      group.imageUrl = track.imageUrl;
    }
  }

  // Sort tracks within each album by track number
  for (const group of albumMap.values()) {
    group.tracks.sort((a, b) => a.trackNumber - b.trackNumber);
  }

  // Return albums sorted alphabetically
  return Array.from(albumMap.values())
    .sort((a, b) => a.albumName.localeCompare(b.albumName));
}

// Fetch music track events (kind 36787) for logged-in user
export async function fetchNostrMusicTracks(
  relays = MUSIC_RELAYS
): Promise<{ success: boolean; tracks: NostrMusicTrackInfo[]; message: string }> {
  if (!hasSigner()) {
    return { success: false, tracks: [], message: 'Not logged in' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();
    const allEvents: NostrEvent[] = [];

    // Query each relay
    const results = await Promise.allSettled(
      relays.map(async (relayUrl) => {
        const ws = await connectRelay(relayUrl);
        try {
          const subId = Math.random().toString(36).substring(7);
          const filter = {
            kinds: [MUSIC_TRACK_KIND],
            authors: [pubkey]
          };

          ws.send(JSON.stringify(['REQ', subId, filter]));
          const events = await collectEvents(ws, subId);
          return events;
        } finally {
          ws.close();
        }
      })
    );

    // Collect all events from successful relays
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEvents.push(...result.value);
      }
    }

    // Deduplicate by d-tag (keep latest version)
    const latestByDTag = new Map<string, NostrEvent>();
    for (const event of allEvents) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || event.id || '';
      const existing = latestByDTag.get(dTag);
      if (!existing || event.created_at > existing.created_at) {
        latestByDTag.set(dTag, event);
      }
    }

    // Parse events to NostrMusicTrackInfo
    const tracks: NostrMusicTrackInfo[] = [];
    for (const event of latestByDTag.values()) {
      const track = parseNostrMusicEvent(event);
      if (track) {
        tracks.push(track);
      }
    }

    // Sort by album name, then track number
    tracks.sort((a, b) => {
      const albumCompare = a.album.localeCompare(b.album);
      if (albumCompare !== 0) return albumCompare;
      return a.trackNumber - b.trackNumber;
    });

    return {
      success: true,
      tracks,
      message: `Found ${tracks.length} track(s)`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, tracks: [], message };
  }
}

// Convert persons array to Credits section string
function formatCreditsFromPersons(persons: Person[]): string {
  if (!persons || persons.length === 0) return '';
  // For each person, list all their roles
  return persons
    .map(p => `${p.name}: ${p.roles.map(r => r.role).join(', ')}`)
    .join('\n');
}

// Check if a string is a valid hex pubkey (64 hex characters)
function isValidHexPubkey(str: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(str);
}

// Check if a string is a valid lightning address (user@domain)
function isValidLightningAddress(str: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str);
}

// Convert value recipients to zap tags (supports lightning addresses and hex pubkeys)
function buildZapTags(recipients: ValueRecipient[], defaultRelay: string): string[][] {
  if (!recipients || recipients.length === 0) return [];

  return recipients
    .filter(r => r.address && r.split > 0 && (isValidLightningAddress(r.address) || isValidHexPubkey(r.address)))
    .map(r => {
      // For lightning addresses, use simpler format without relay
      if (isValidLightningAddress(r.address)) {
        return ['zap', r.address, String(r.split)];
      }
      // For hex pubkeys, include relay
      return ['zap', r.address, defaultRelay, String(r.split)];
    });
}

// Build content field with description and credits
function buildTrackContent(track: Track): string {
  const sections: string[] = [];

  // Description as plain content
  if (track.description && track.description.trim()) {
    sections.push(track.description.trim());
  }

  // Credits from persons
  const credits = formatCreditsFromPersons(track.persons);
  if (credits) {
    sections.push(`Credits:\n${credits}`);
  }

  return sections.join('\n\n');
}

// Create a kind 36787 event for a track
function createMusicTrackEvent(
  track: Track,
  album: Album,
  pubkey: string
): NostrEvent {
  const tags: string[][] = [
    ['d', track.guid],
    ['title', track.title],
    ['url', track.enclosureUrl],
    ['artist', album.author || 'Unknown Artist'],
    ['album', album.title || 'Untitled'],
    ['track_number', String(track.trackNumber)],
    ['client', CLIENT_TAG],
    ['alt', `Music track: ${track.title} by ${album.author || 'Unknown Artist'}`]
  ];

  // Add duration
  if (track.duration) {
    tags.push(['duration', String(track.duration)]);
  }

  // Add explicit flag
  if (track.explicit) {
    tags.push(['explicit', 'true']);
  }

  // Add image (track art or album art)
  const imageUrl = track.trackArtUrl || album.imageUrl;
  if (imageUrl) {
    tags.push(['image', imageUrl]);
  }

  // Add released date
  const released = formatReleasedDate(track.pubDate);
  if (released) {
    tags.push(['released', released]);
  }

  // Add language
  if (album.language) {
    tags.push(['language', album.language]);
  }

  // Add genre tags from categories (music discriminator first, then user genres)
  tags.push(['t', 'music']);
  for (const category of album.categories) {
    tags.push(['t', category.toLowerCase()]);
  }

  // Add zap tags from value recipients (track-level if overridden, else album-level)
  const valueBlock = track.overrideValue && track.value ? track.value : album.value;
  if (valueBlock && valueBlock.recipients) {
    const zapTags = buildZapTags(valueBlock.recipients, DEFAULT_RELAYS[0]);
    tags.push(...zapTags);
  }

  // Build content with lyrics and credits
  const content = buildTrackContent(track);

  return {
    kind: MUSIC_TRACK_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };
}

// Create a kind 34139 playlist event referencing published tracks
function createMusicPlaylistEvent(
  album: Album,
  publishedTracks: PublishedTrackRef[],
  pubkey: string
): NostrEvent {
  const tags: string[][] = [
    // Required tags per NIP
    ['d', album.podcastGuid],
    ['title', album.title || 'Untitled Playlist'],
    ['alt', `Playlist: ${album.title || 'Untitled'} by ${album.author || 'Unknown Artist'}`],
    // Client identifier
    ['client', CLIENT_TAG]
  ];

  // Optional: description tag
  if (album.description?.trim()) {
    tags.push(['description', album.description.trim()]);
  }

  // Optional: image tag (album artwork)
  if (album.imageUrl?.trim()) {
    tags.push(['image', album.imageUrl]);
  }

  // Track references as 'a' tags in order
  // Format: "36787:<pubkey>:<d-tag>"
  for (const track of publishedTracks) {
    tags.push(['a', `${MUSIC_TRACK_KIND}:${track.pubkey}:${track.dTag}`]);
  }

  // Category tags for discovery
  for (const category of album.categories) {
    tags.push(['t', category.toLowerCase()]);
  }

  // Add zap tags from album value recipients
  if (album.value && album.value.recipients) {
    const zapTags = buildZapTags(album.value.recipients, DEFAULT_RELAYS[0]);
    tags.push(...zapTags);
  }

  // Default to public playlist
  tags.push(['public', 'true']);

  // Content field: playlist description
  const content = album.description?.trim() || '';

  return {
    kind: MUSIC_PLAYLIST_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };
}

// Publish result for progress tracking
export interface PublishProgress {
  current: number;
  total: number;
  trackTitle: string;
  phase: 'tracks' | 'playlist';
}

// Publish album tracks as Nostr Music events (kind 36787) + playlist (kind 34139)
export async function publishNostrMusicTracks(
  album: Album,
  relays = MUSIC_RELAYS,
  onProgress?: (progress: PublishProgress) => void
): Promise<{ success: boolean; message: string; publishedCount: number; playlistPublished: boolean }> {
  if (!hasSigner()) {
    return { success: false, message: 'Not logged in', publishedCount: 0, playlistPublished: false };
  }

  if (!album.tracks || album.tracks.length === 0) {
    return { success: false, message: 'No tracks to publish', publishedCount: 0, playlistPublished: false };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();
    let publishedCount = 0;
    const total = album.tracks.length;
    const publishedTracks: PublishedTrackRef[] = [];

    // Phase 1: Publish all tracks
    for (let i = 0; i < album.tracks.length; i++) {
      const track = album.tracks[i];

      // Skip tracks without required fields
      if (!track.title || !track.enclosureUrl) {
        continue;
      }

      // Report progress (tracks phase)
      if (onProgress) {
        onProgress({ current: i + 1, total, trackTitle: track.title, phase: 'tracks' });
      }

      // Create and sign the event
      const unsignedEvent = createMusicTrackEvent(track, album, pubkey);
      const signedEvent = await signer.signEvent(unsignedEvent);

      // Publish to all relays
      const { successCount } = await publishEventToRelays(signedEvent as NostrEvent, relays);

      // Count as published if at least one relay succeeded
      if (successCount > 0) {
        publishedCount++;
        // Record successful publish for playlist reference
        publishedTracks.push({ dTag: track.guid, pubkey });
      }
    }

    if (publishedCount === 0) {
      return { success: false, message: 'Failed to publish any tracks', publishedCount: 0, playlistPublished: false };
    }

    // Phase 2: Publish playlist (only if 2+ tracks - single track isn't a playlist)
    let playlistPublished = false;

    if (publishedTracks.length >= 2) {
      if (onProgress) {
        onProgress({ current: 1, total: 1, trackTitle: album.title || 'Playlist', phase: 'playlist' });
      }

      const playlistEvent = createMusicPlaylistEvent(album, publishedTracks, pubkey);
      const signedPlaylist = await signer.signEvent(playlistEvent);
      const { successCount: playlistSuccessCount } = await publishEventToRelays(signedPlaylist as NostrEvent, relays);

      if (playlistSuccessCount > 0) {
        playlistPublished = true;
      }
    }

    // Build appropriate message
    let message: string;
    if (publishedTracks.length < 2) {
      message = `Published ${publishedCount} track(s) to Nostr`;
    } else if (playlistPublished) {
      message = `Published ${publishedCount} track(s) and playlist to Nostr`;
    } else {
      message = `Published ${publishedCount} track(s) to Nostr (playlist failed)`;
    }

    return {
      success: true,
      message,
      publishedCount,
      playlistPublished
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message, publishedCount: 0, playlistPublished: false };
  }
}

// Delete (unpublish) Nostr Music events for an album via NIP-09
export async function deleteNostrMusicTracks(
  album: Album,
  relays = MUSIC_RELAYS
): Promise<{ success: boolean; message: string }> {
  if (!hasSigner()) {
    return { success: false, message: 'Not logged in' };
  }

  if (!album.tracks || album.tracks.length === 0) {
    return { success: false, message: 'No tracks to delete' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();

    // Build 'a' tags for all tracks + playlist
    const tags: string[][] = [];

    for (const track of album.tracks) {
      if (track.guid) {
        tags.push(['a', `${MUSIC_TRACK_KIND}:${pubkey}:${track.guid}`]);
      }
    }

    // Include playlist deletion if album has 2+ tracks
    if (album.tracks.length >= 2 && album.podcastGuid) {
      tags.push(['a', `${MUSIC_PLAYLIST_KIND}:${pubkey}:${album.podcastGuid}`]);
    }

    if (tags.length === 0) {
      return { success: false, message: 'No events to delete' };
    }

    const deletionEvent = {
      kind: DELETION_KIND,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: 'Unpublished from MSP 2.0'
    };

    const signedEvent = await signer.signEvent(deletionEvent);
    const { successCount } = await publishEventToRelays(signedEvent as NostrEvent, relays);

    if (successCount === 0) {
      return { success: false, message: 'Failed to send deletion request to any relay' };
    }

    const trackCount = album.tracks.filter(t => t.guid).length;
    const hasPlaylist = album.tracks.length >= 2 && album.podcastGuid;
    const target = hasPlaylist
      ? `${trackCount} track(s) and playlist`
      : `${trackCount} track(s)`;
    const message = `Sent deletion request for ${target} to ${successCount}/${relays.length} relays (relays may take time to honor it)`;

    return { success: true, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}

