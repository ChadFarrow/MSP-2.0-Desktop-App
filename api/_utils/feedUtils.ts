// Shared API utilities for hosted feed endpoints
import type { VercelRequest } from '@vercel/node';
import { createHash } from 'crypto';

const PI_API_KEY = process.env.PODCASTINDEX_API_KEY;
const PI_API_SECRET = process.env.PODCASTINDEX_API_SECRET;

/**
 * Generate Podcast Index API auth headers
 */
function getPodcastIndexHeaders(): Record<string, string> {
  if (!PI_API_KEY || !PI_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = createHash('sha1')
    .update(PI_API_KEY + PI_API_SECRET + apiHeaderTime)
    .digest('hex');

  return {
    'X-Auth-Key': PI_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hash,
    'User-Agent': 'MSP2.0/1.0 (Music Side Project Studio)'
  };
}

/**
 * Submit feed to Podcast Index and return PI ID if available
 * Uses pubnotify to trigger re-crawl, then add/byfeedurl for new feeds
 */
export async function notifyPodcastIndex(feedUrl: string): Promise<number | null> {
  // First, send pubnotify to trigger re-crawl (works for updates, no auth required)
  try {
    await fetch(
      `https://api.podcastindex.org/api/1.0/hub/pubnotify?url=${encodeURIComponent(feedUrl)}`,
      {
        headers: { 'User-Agent': 'MSP2.0/1.0 (Music Side Project Studio)' }
      }
    );
  } catch (err) {
    console.warn('Failed to send pubnotify:', err instanceof Error ? err.message : err);
  }

  // Then try to get PI ID via add/byfeedurl (for new feeds) or lookup
  if (!PI_API_KEY || !PI_API_SECRET) return null;

  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { method: 'POST', headers }
    );

    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.feed?.id) {
          return data.feed.id;
        }
      } catch {
        // JSON parse failed
      }
    }
  } catch (err) {
    console.warn('Failed to add feed to Podcast Index:', err instanceof Error ? err.message : err);
  }
  return null;
}

/**
 * Look up existing feed's PI ID from Podcast Index by GUID
 */
export async function lookupPodcastIndexId(podcastGuid: string): Promise<number | null> {
  if (!PI_API_KEY || !PI_API_SECRET) return null;

  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`,
      { headers }
    );

    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.feed?.id) {
          return data.feed.id;
        }
      } catch {
        // JSON parse failed
      }
    }
  } catch (err) {
    console.warn('Failed to lookup Podcast Index ID:', err instanceof Error ? err.message : err);
  }
  return null;
}

/**
 * Get base URL from request headers
 * Falls back to canonical URL for localhost (PI can't reach local dev servers)
 */
export function getBaseUrl(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';

  // Use canonical URL for localhost since PI can't reach local dev servers
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return process.env.CANONICAL_URL || 'https://msp.podtards.com';
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

/**
 * Hash token for storage/comparison (never store raw token)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validate feedId format (UUID)
 */
export function isValidFeedId(feedId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(feedId);
}
