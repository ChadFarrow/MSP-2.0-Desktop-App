// Shared hosted-feed hydration: given a feedId + its blob URLs, build the listing object
// (meta fields + author/medium extracted from the XML + a lazily-resolved Podcast Index id).
// Used by both the Nostr "list my feeds" path (api/hosted GET) and the email-account path
// (api/account/feeds) so both return an identical shape.
import { list, put } from '@vercel/blob';
import { lookupPodcastIndexId } from './feedUtils.js';
import { extractPodcastMedium } from './xmlUtils.js';

export interface HydratedFeed {
  feedId: string;
  author?: string;
  medium?: string;
  [key: string]: unknown;
}

/**
 * Hydrate one feed from its meta + (optional) xml blob URLs.
 * Mirrors the original inline logic in api/hosted/index.ts so the listing shape is unchanged.
 */
export async function hydrateFeed(feedId: string, metaUrl: string, xmlUrl?: string): Promise<HydratedFeed> {
  const metaResponse = await fetch(metaUrl);
  const metaText = await metaResponse.text();
  const meta = metaText ? JSON.parse(metaText) : {};

  let author: string | undefined;
  let medium: string | undefined;
  if (xmlUrl) {
    try {
      const xml = await (await fetch(xmlUrl)).text();
      const authorMatch = xml.match(/<itunes:author>([^<]+)<\/itunes:author>/);
      if (authorMatch) author = authorMatch[1];
      const extractedMedium = extractPodcastMedium(xml);
      if (extractedMedium) medium = extractedMedium;
    } catch {
      // Ignore errors extracting metadata
    }
  }

  let podcastIndexId = meta.podcastIndexId;
  if (!podcastIndexId) {
    podcastIndexId = await lookupPodcastIndexId(feedId);
    if (podcastIndexId) {
      put(`feeds/${feedId}.meta.json`, JSON.stringify({ ...meta, podcastIndexId }), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      }).catch(err => console.warn('Failed to update metadata with PI ID:', err));
    }
  }

  return { feedId, author, medium, ...meta, podcastIndexId };
}

/**
 * Hydrate a feed by id, listing its blobs first. Returns null if the feed has no metadata.
 */
export async function hydrateFeedById(feedId: string): Promise<HydratedFeed | null> {
  const { blobs } = await list({ prefix: `feeds/${feedId}` });
  const metaBlob = blobs.find(b => b.pathname === `feeds/${feedId}.meta.json`);
  if (!metaBlob) return null;
  const xmlBlob = blobs.find(b => b.pathname === `feeds/${feedId}.xml` && !b.pathname.includes('.backup.'));
  return hydrateFeed(feedId, metaBlob.url, xmlBlob?.url);
}
