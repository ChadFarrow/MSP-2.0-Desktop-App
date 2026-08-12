// Shared API utilities for hosted feed endpoints
import { createHash, timingSafeEqual } from 'crypto';
import { getAuthHeaders } from './podcastIndex.js';
import { normalizeFeedUrl } from './urlValidation.js';

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
  rawFeedUrl: string,
  options: PodpingOptions = {}
): Promise<PodpingResult> {
  // Last choke point before the URL leaves MSP. Also covers the hosted POST/PUT
  // paths, which reach here without passing through an /api handler's guard.
  const feedUrl = normalizeFeedUrl(rawFeedUrl);
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
 * Why PI's add/byfeedurl didn't hand back a feed id. Same shape `/api/pubnotify`
 * already returns, so both submission paths explain failures identically.
 */
export interface PodcastIndexAddResult {
  /** HTTP status from add/byfeedurl, when a response came back at all. */
  httpStatus?: number;
  /** PI's own `status` field — usually the string `"false"` on a rejection. */
  status?: unknown;
  /** PI's reason for the rejection, or a locally-composed one. */
  description?: string | null;
  /** Set when the request itself threw (network failure, PI unreachable). */
  error?: string;
}

export interface PodcastIndexNotifyResult {
  podcastIndexId: number | null;
  /** Present only when no feed id came back — explains why registration didn't happen. */
  addResult?: PodcastIndexAddResult;
}

/**
 * Submit feed to Podcast Index and return the PI ID if available.
 * Uses pubnotify to trigger re-crawl, then add/byfeedurl for new feeds.
 *
 * A missing id is not the same as a failure to try — `addResult` carries PI's
 * explanation so callers can tell the user why the feed isn't indexed instead
 * of leaving the reason buried in function logs.
 */
export async function notifyPodcastIndex(
  rawFeedUrl: string,
  options: { medium?: string } = {}
): Promise<PodcastIndexNotifyResult> {
  // Same choke point as notifyPodping — hosted POST/PUT reaches here directly.
  const feedUrl = normalizeFeedUrl(rawFeedUrl);

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
  notifyPodping(feedUrl, { reason: 'update', medium: options.medium }).then((result) => {
    if (!result.ok) {
      console.warn(`Podping broadcast failed for ${feedUrl}: ${result.error ?? 'unknown'}`);
    }
  });

  // Then try to get PI ID via add/byfeedurl (for new feeds) or lookup
  if (!PI_API_KEY || !PI_API_SECRET) {
    return { podcastIndexId: null, addResult: { description: 'Podcast Index API credentials not configured' } };
  }

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
          return { podcastIndexId: data.feed.id };
        }
        // No feed id returned — surface why (PI sends status/description explaining
        // rejections: unauthorized key, feed unreachable, duplicate guid, etc.)
        console.warn(
          `PI add/byfeedurl did not register ${feedUrl} — HTTP ${response.status}, ` +
          `status=${data.status}, description=${data.description ?? '(none)'}`
        );
        return {
          podcastIndexId: null,
          addResult: { httpStatus: response.status, status: data.status, description: data.description ?? null }
        };
      } catch {
        console.warn(`PI add/byfeedurl returned non-JSON for ${feedUrl} — HTTP ${response.status}: ${text.slice(0, 200)}`);
        return {
          podcastIndexId: null,
          addResult: { httpStatus: response.status, description: `non-JSON: ${text.slice(0, 200)}` }
        };
      }
    }
    console.warn(`PI add/byfeedurl returned empty body for ${feedUrl} — HTTP ${response.status}`);
    return {
      podcastIndexId: null,
      addResult: { httpStatus: response.status, description: 'empty response body' }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to add feed to Podcast Index:', message);
    return { podcastIndexId: null, addResult: { error: message } };
  }
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
 * Get the canonical base URL for hosted feed links.
 */
export function getBaseUrl(): string {
  // Always use the canonical domain for hosted feed URLs so every feed (album,
  // video, publisher) is stable regardless of which alias/preview host served the
  // request. msp.podtards.com is a legacy alias and must never appear in newly
  // generated feed URLs.
  return (process.env.CANONICAL_URL || 'https://musicsideproject.com').replace(/\/$/, '');
}

/**
 * Hash token for storage/comparison (never store raw token)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two arbitrary strings.
 *
 * timingSafeEqualHex below can't be used for these: it does Buffer.from(x, 'hex'),
 * which silently truncates anything that isn't hex. Secrets like MSP_ADMIN_KEY are
 * free-form, so hash both sides first — that also removes the length side-channel,
 * since two SHA-256 digests are always the same size.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
}

/**
 * Constant-time comparison of two hex strings (e.g. token hashes).
 * Returns false on any length mismatch without leaking timing on the contents.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate feedId format (UUID)
 */
export function isValidFeedId(feedId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(feedId);
}
