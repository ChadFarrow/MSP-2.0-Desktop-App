// Nostr Video Event (NIP-71, kind 34235/34236) resolution and parsing
// Decodes naddr strings, fetches events from relays, and extracts video metadata

import { decode } from 'nostr-tools/nip19';
import type { NostrEvent } from '../types/nostr';
import { queryEventsFromRelays, DEFAULT_RELAYS } from './nostrRelay';

// NIP-71 video event kinds
const VIDEO_KIND = 34235;
const SHORT_VIDEO_KIND = 34236;

/** Extracted video metadata from a NIP-71 event */
export interface VideoTrackData {
  url: string;
  mimeType: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  duration?: string;         // seconds as string (from event), converted to HH:MM:SS by caller
  durationSeconds?: number;
  fileSize?: string;
  publishedAt?: string;      // RFC 822 date string for RSS
  categories: string[];
}

/**
 * Detect if a string is an naddr (with or without nostr: prefix)
 */
export function isNaddrString(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith('naddr1') || trimmed.startsWith('nostr:naddr1');
}

/**
 * Strip nostr: prefix if present and return the bare naddr
 */
function stripNostrPrefix(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('nostr:')) {
    return trimmed.slice(6);
  }
  return trimmed;
}

/**
 * Decode an naddr string and fetch the corresponding event from relays.
 * Returns the most recent matching event.
 */
export async function resolveNaddr(input: string): Promise<NostrEvent> {
  const bare = stripNostrPrefix(input);

  const decoded = decode(bare);
  if (decoded.type !== 'naddr') {
    throw new Error(`Expected naddr, got ${decoded.type}`);
  }

  const { kind, pubkey, identifier, relays } = decoded.data;

  // Use relays from the naddr if provided, plus defaults as fallback
  const relayList = relays && relays.length > 0
    ? [...new Set([...relays, ...DEFAULT_RELAYS])]
    : DEFAULT_RELAYS;

  const filter = {
    kinds: [kind],
    authors: [pubkey],
    '#d': [identifier],
  };

  const events = await queryEventsFromRelays(filter, relayList);

  if (events.length === 0) {
    throw new Error('Video event not found on any relay');
  }

  // Return the most recent event
  return events.reduce((latest, e) =>
    e.created_at > latest.created_at ? e : latest
  );
}

/**
 * Parse an imeta tag into a key-value map.
 * imeta format: ["imeta", "url https://...", "m video/mp4", "dim 1920x1080", ...]
 */
function parseImetaTag(tag: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  // Skip tag[0] which is "imeta"
  for (let i = 1; i < tag.length; i++) {
    const spaceIndex = tag[i].indexOf(' ');
    if (spaceIndex > 0) {
      const key = tag[i].substring(0, spaceIndex);
      const value = tag[i].substring(spaceIndex + 1);
      // For repeatable keys like "fallback", only keep first
      if (!result[key]) {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * Convert seconds (number or string) to HH:MM:SS format
 */
function secondsToHHMMSS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/**
 * Parse a NIP-71 video event (kind 34235 or 34236) and extract track data.
 * Supports both modern imeta tags and legacy separate tags.
 */
export function parseVideoEvent(event: NostrEvent): VideoTrackData {
  const kind = event.kind;
  if (kind !== VIDEO_KIND && kind !== SHORT_VIDEO_KIND) {
    throw new Error(`Expected video event (kind ${VIDEO_KIND} or ${SHORT_VIDEO_KIND}), got kind ${kind}`);
  }

  const getTag = (name: string): string | undefined =>
    event.tags.find(t => t[0] === name)?.[1];

  // Try imeta first (modern format)
  const imetaTag = event.tags.find(t => t[0] === 'imeta');
  const imeta = imetaTag ? parseImetaTag(imetaTag) : null;

  // Extract video URL
  const url = imeta?.url || getTag('url');
  if (!url) {
    throw new Error('No video URL found in event (checked imeta and url tags)');
  }

  // Extract MIME type
  const mimeType = imeta?.m || getTag('m') || 'video/mp4';

  // Extract title
  const title = getTag('title') || '';

  // Extract description from content
  const description = event.content || '';

  // Extract thumbnail
  const thumbnailUrl = imeta?.image || getTag('thumb') || getTag('image');

  // Extract duration (imeta stores as seconds string)
  let durationSeconds: number | undefined;
  const durationStr = imeta?.duration;
  if (durationStr) {
    durationSeconds = parseFloat(durationStr);
  }

  // Extract file size
  const fileSize = imeta?.size || getTag('size');

  // Extract published_at and convert to RFC 822
  let publishedAt: string | undefined;
  const publishedAtTag = getTag('published_at');
  if (publishedAtTag) {
    const timestamp = parseInt(publishedAtTag);
    if (!isNaN(timestamp)) {
      publishedAt = new Date(timestamp * 1000).toUTCString();
    }
  }

  // Extract categories from t tags
  const categories = event.tags
    .filter(t => t[0] === 't')
    .map(t => t[1])
    .filter(Boolean);

  return {
    url,
    mimeType,
    title,
    description,
    thumbnailUrl,
    duration: durationSeconds ? secondsToHHMMSS(durationSeconds) : undefined,
    durationSeconds,
    fileSize,
    publishedAt,
    categories,
  };
}

/**
 * Full pipeline: detect naddr, resolve from relays, parse video metadata.
 * Returns null if the input is not an naddr string.
 * Throws on resolution or parsing errors.
 */
export async function resolveNostrVideo(input: string): Promise<VideoTrackData | null> {
  if (!isNaddrString(input)) {
    return null;
  }

  const event = await resolveNaddr(input);
  return parseVideoEvent(event);
}
