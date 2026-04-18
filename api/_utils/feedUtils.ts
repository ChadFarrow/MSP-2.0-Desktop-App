// Shared API utilities for hosted feed endpoints
import type { VercelRequest } from '@vercel/node';
import { createHash } from 'crypto';
import { getAuthHeaders } from './podcastIndex.js';

const PI_API_KEY = process.env.PODCASTINDEX_API_KEY;
const PI_API_SECRET = process.env.PODCASTINDEX_API_SECRET;
const PODPING_USER_AGENT = 'MSP2.0/1.0 (Music Side Project Studio)';

export interface PodpingOptions {
  reason?: string;
  medium?: string;
}

export interface PodpingResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * True when both PODPING_ENDPOINT_URL and PODPING_BEARER_TOKEN are set.
 * Callers use this to short-circuit before attempting a broadcast.
 */
export function isPodpingConfigured(): boolean {
  return Boolean(process.env.PODPING_ENDPOINT_URL && process.env.PODPING_BEARER_TOKEN);
}

/**
 * Submit a feed-update notification to the MSP podping-hivepinger deployment.
 * No-ops (returns ok: false) when PODPING_ENDPOINT_URL or PODPING_BEARER_TOKEN is unset
 * so callers can fire-and-forget.
 */
export async function notifyPodping(
  feedUrl: string,
  options: PodpingOptions = {}
): Promise<PodpingResult> {
  const endpoint = process.env.PODPING_ENDPOINT_URL;
  if (!endpoint) {
    return { ok: false, error: 'PODPING_ENDPOINT_URL not configured' };
  }

  const token = process.env.PODPING_BEARER_TOKEN;
  if (!token) {
    return { ok: false, error: 'PODPING_BEARER_TOKEN not configured' };
  }

  const params = new URLSearchParams({ url: feedUrl });
  if (options.reason) params.set('reason', options.reason);
  if (options.medium) params.set('medium', options.medium);

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': PODPING_USER_AGENT
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`Podping submission failed: ${response.status} ${body}`);
      return { ok: false, status: response.status, error: body || response.statusText };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to submit podping:', message);
    return { ok: false, error: message };
  }
}

/**
 * Generate Podcast Index API auth headers (throws if not configured)
 */
function getPodcastIndexHeaders(): Record<string, string> {
  const headers = getAuthHeaders();
  if (!headers) {
    throw new Error('Podcast Index API credentials not configured');
  }
  return headers;
}

/**
 * Submit feed to Podcast Index and return PI ID if available
 * Uses pubnotify to trigger re-crawl, then add/byfeedurl for new feeds
 */
export async function notifyPodcastIndex(
  feedUrl: string,
  options: { medium?: string } = {}
): Promise<number | null> {
  // First, send pubnotify to trigger re-crawl (works for updates, no auth required)
  try {
    await fetch(
      `https://api.podcastindex.org/api/1.0/hub/pubnotify?url=${encodeURIComponent(feedUrl)}`,
      {
        headers: { 'User-Agent': PODPING_USER_AGENT }
      }
    );
  } catch (err) {
    console.warn('Failed to send pubnotify:', err instanceof Error ? err.message : err);
  }

  // Broadcast feed update via self-hosted hivepinger (no-ops without PODPING_ENDPOINT_URL + PODPING_BEARER_TOKEN).
  // Intentionally not awaited so PI submission isn't blocked; surface failures to function logs.
  notifyPodping(feedUrl, { medium: options.medium }).then((result) => {
    if (!result.ok) {
      console.warn(`Podping broadcast failed for ${feedUrl}: ${result.error ?? 'unknown'}`);
    }
  });

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
