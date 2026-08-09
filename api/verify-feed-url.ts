import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from './_utils/rateLimiter.js';
import { getFeedUrlError, normalizeFeedUrl } from './_utils/urlValidation.js';
import { assertPublicHttpUrl, getClientIp } from './_utils/urlSafety.js';

/**
 * Confirm a feed URL actually resolves to something feed-shaped, before MSP hands
 * it to Podcast Index.
 *
 * GET /api/verify-feed-url?url=<encoded>
 * → 200 { reachable, status?, looksLikeFeed?, finalUrl?, reason? }
 *
 * Why this exists next to /api/proxy-feed: proxy-feed returns the fetched body to
 * the browser, so it carries a domain allowlist — which makes it useless here,
 * because the musicians who need checking are precisely the ones self-hosting on
 * a domain that will never be on a list. This endpoint returns a *verdict only*
 * and never the bytes, which is what lets it safely drop the allowlist.
 *
 * DO NOT make this return response content. The allowlist is absent on the
 * explicit condition that nothing fetched here reaches the caller.
 */

const RATE_LIMIT = { limit: 30, windowMs: 3600_000 };
// The limiter is keyed by a plain string shared across endpoints, so namespace it.
const RATE_LIMIT_PREFIX = 'verify-feed-url:';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
// Enough to see the opening tag of any real feed without buffering a whole podcast.
const MAX_SNIFF_BYTES = 64 * 1024;
const FEED_MARKERS = ['<rss', '<feed', '<channel'];

interface FetchOutcome {
  reachable: boolean;
  status?: number;
  looksLikeFeed?: boolean;
  finalUrl?: string;
  reason?: string;
}

/** Read at most maxBytes of the body, then abort. Never returned to the caller. */
async function sniffBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  try {
    while (text.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, maxBytes);
}

/**
 * Follow redirects by hand so every hop gets the SSRF checks. `redirect: 'follow'`
 * would let a public URL bounce to 169.254.169.254 behind our back.
 *
 * `startUrl` must already have passed assertPublicHttpUrl — the caller checks it
 * so a blocked first hop can be reported as an HTTP 403 rather than a verdict.
 */
async function fetchWithGuardedRedirects(startUrl: string, signal: AbortSignal): Promise<FetchOutcome> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (hop > 0) {
      const safety = await assertPublicHttpUrl(current);
      if (!safety.ok) {
        return { reachable: false, reason: `Redirected to a blocked address (${safety.error})` };
      }
    }

    const response = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'MSP-FeedVerifier/1.0'
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { reachable: false, status: response.status, reason: 'Redirect with no destination' };
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      return { reachable: false, status: response.status, finalUrl: current };
    }

    const body = await sniffBody(response, MAX_SNIFF_BYTES);
    const looksLikeFeed = FEED_MARKERS.some((marker) => body.includes(marker));
    return { reachable: true, status: response.status, looksLikeFeed, finalUrl: current };
  }

  return { reachable: false, reason: 'Too many redirects' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: rawUrl } = req.query as { url?: string };

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const url = normalizeFeedUrl(rawUrl);
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const urlError = getFeedUrlError(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  const rate = checkRateLimit(`${RATE_LIMIT_PREFIX}${getClientIp(req)}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many verification requests. Try again later.' });
  }

  // Check the first hop here rather than inside the loop: a blocked address is a
  // refusal by MSP (403), whereas a host that simply doesn't resolve is a verdict
  // about the user's URL (200 + reachable:false) and reads very differently.
  const preflight = await assertPublicHttpUrl(url);
  if (!preflight.ok) {
    if (preflight.status === 403) {
      return res.status(403).json({ error: preflight.error });
    }
    return res.status(200).json({ reachable: false, reason: preflight.error });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const outcome = await fetchWithGuardedRedirects(url, controller.signal);
    return res.status(200).json(outcome);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return res.status(200).json({
      reachable: false,
      reason: aborted ? 'Timed out after 10 seconds' : 'Could not connect to that address'
    });
  } finally {
    clearTimeout(timer);
  }
}
