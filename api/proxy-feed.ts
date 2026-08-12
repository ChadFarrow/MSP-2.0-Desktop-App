import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getClientIp } from './_utils/urlSafety.js';
import { checkRateLimit } from './_utils/rateLimiter.js';
import { normalizeFeedUrl } from './_utils/urlValidation.js';
import { safeFetchFollow, readCapped, looksLikeFeedText } from './_utils/safeFetch.js';
import { applyCors } from './_utils/cors.js';

/**
 * Server-side proxy to fetch feeds — avoids CORS issues.
 * GET /api/proxy-feed?url=<encoded-url>
 *
 * This endpoint returns the fetched BODY, which is the whole reason it is
 * dangerous. It used to carry a 17-domain allowlist for that reason — and that
 * allowlist 403'd every self-hosted musician domain, breaking Import-from-URL
 * and the publisher Download Feed button for exactly the people MSP exists for.
 * (Contrast /api/verify-feed-url, which safely has no allowlist because it
 * returns a verdict and never the bytes. Different bargain, not the same one.)
 *
 * The allowlist was replaced, not simply dropped. Six guards, all load-bearing:
 *   1. assertPublicHttpUrl on the first hop AND every redirect hop (safeFetch).
 *   2. A hard byte cap; an oversized body is refused, never truncated-and-served.
 *   3. A feed-shape sniff BEFORE any byte is written to the response, so an
 *      attacker can only ever read back documents that look like RSS/Atom.
 *   4. Nothing from the client request is forwarded: no cookies, no
 *      Authorization, a fixed outbound header set. URL userinfo is rejected here
 *      and stripped again on every redirect hop inside safeFetch — rejecting it
 *      only on the URL we were handed still relays credentials one hop later.
 *   5. No upstream response header is echoed, and Content-Type is FORCED to XML
 *      — passing through text/html here would be stored XSS on our own origin.
 *   6. A per-IP rate limit.
 * Removing any one of these puts us back to an open SSRF read primitive.
 *
 * KNOWN RESIDUAL — DNS rebinding: assertPublicHttpUrl resolves the hostname,
 * then fetch resolves it again, so a TTL-0 record can answer public to the check
 * and private to the connect. The fix is an undici Agent whose connect.lookup
 * re-validates and pins the checked IP; undici is only a transitive dependency
 * today, so that is tracked as follow-up. Exposure is bounded by guard 3 — what
 * comes back must still pass the feed sniff.
 */

const RATE_LIMIT = { limit: 60, windowMs: 3600_000 };
// The limiter is one shared Map keyed by a plain string, so namespace it or this
// endpoint silently shares a bucket with every other unprefixed caller.
const RATE_LIMIT_PREFIX = 'proxy-feed:';

/**
 * Under Vercel's default function budget, with up to 5 redirect hops inside it.
 * vercel.json sets no functions.maxDuration; raise both together or neither.
 */
const TIMEOUT_MS = 8_000;
/**
 * Sits deliberately *below* Vercel's hard 4.5 MB response-body ceiling
 * (FUNCTION_PAYLOAD_TOO_LARGE). Past that the platform kills the response and the
 * user gets an opaque 413 with no explanation, so MSP has to refuse first to be
 * able to say anything useful. Raising this above ~4.4 MB does not make bigger
 * feeds work — it just hands the failure to Vercel. Genuinely large feeds are
 * served by the client's own direct fetch, which has no such ceiling; the proxy
 * is only the CORS fallback.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
/**
 * Higher than safeFetch's default of 5, which suits verify-feed-url's 4 s budget.
 * Shared hosting chains http → https → www → trailing-slash → CDN → region and
 * runs past 5 hops legitimately; Node's own `redirect: 'follow'` default, which
 * this endpoint used before the manual walk, was 20.
 */
export const MAX_REDIRECTS = 10;
/**
 * The feed marker must appear near the top. A multi-megabyte HTML page with
 * "<rss" in a footer comment is not a feed, and would otherwise pass the sniff.
 * Measured against the real-feed corpus (feedCorpus.network.test.ts) every feed
 * MSP cares about carries its marker in the first few hundred bytes, so this
 * window is already generous — widen it only with evidence, since every byte of
 * it is somewhere an attacker can hide a marker.
 */
export const SNIFF_WINDOW = 64 * 1024;

/** Fixed. The client's own headers are never forwarded upstream. */
const OUTBOUND_HEADERS = {
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
  'User-Agent': 'MSP-FeedProxy/1.0'
};

/** Mirrored by CODE_MESSAGES in src/utils/xmlParser.ts — keep the names in step. */
type ErrorCode =
  | 'invalid-url'
  | 'unsafe-address'
  | 'rate-limited'
  | 'blocked'
  | 'not-found'
  | 'upstream-error'
  | 'not-a-feed'
  | 'too-large'
  | 'timeout'
  | 'network'
  | 'too-many-redirects';

function fail(
  res: VercelResponse,
  http: number,
  code: ErrorCode,
  error: string,
  status?: number
) {
  return res.status(http).json({ error, code, ...(status ? { status } : {}) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: rawUrl } = req.query as { url?: string };
  if (!rawUrl || typeof rawUrl !== 'string') {
    return fail(res, 400, 'invalid-url', 'Missing url parameter');
  }

  const url = normalizeFeedUrl(rawUrl);
  if (!url) {
    return fail(res, 400, 'invalid-url', 'Missing url parameter');
  }

  // Deliberately NOT getFeedUrlError(). That rule table is about what is fit to
  // *submit to Podcast Index* (apostrophes, non-ASCII); a feed URL that already
  // contains one is still perfectly fetchable, and refusing to download it would
  // be a new bug. /api/verify-feed-url applies it; this must not.

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(res, 400, 'invalid-url', 'Invalid URL');
  }

  // Node's fetch turns https://user:pass@host into an Authorization header.
  // Nothing legitimate needs it, and honouring it makes us a credential relay.
  if (parsed.username || parsed.password) {
    return fail(res, 400, 'invalid-url', 'URLs with embedded credentials are not supported');
  }

  const rate = checkRateLimit(`${RATE_LIMIT_PREFIX}${getClientIp(req)}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return fail(res, 429, 'rate-limited', 'Too many feed requests. Try again later.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await safeFetchFollow(url, {
      signal: controller.signal,
      headers: OUTBOUND_HEADERS,
      maxRedirects: MAX_REDIRECTS
      // startAlreadyChecked omitted on purpose: hop 0 is checked inside.
    });

    if (!result.ok) {
      if (result.kind === 'unsafe') {
        return result.safety.status === 403
          ? fail(res, 403, 'unsafe-address', result.reason)
          : fail(res, 400, 'invalid-url', result.reason);
      }
      return fail(
        res,
        502,
        result.kind === 'too-many-redirects' ? 'too-many-redirects' : 'upstream-error',
        result.reason
      );
    }

    const { response } = result;
    if (!response.ok) {
      const code: ErrorCode =
        response.status === 404 || response.status === 410
          ? 'not-found'
          : response.status === 401 || response.status === 403 || response.status === 429
            ? 'blocked'
            : 'upstream-error';
      return fail(res, response.status, code, `The feed host returned ${response.status}.`, response.status);
    }

    const { text, truncated } = await readCapped(response, MAX_BODY_BYTES);
    if (truncated) {
      return fail(
        res,
        413,
        'too-large',
        'That feed is too large to fetch through MSP. Download the XML and import it as a file instead.'
      );
    }

    // Runs BEFORE anything is written. This is what stops the endpoint being a
    // general-purpose "read any URL and hand me the bytes" primitive.
    if (!looksLikeFeedText(text.slice(0, SNIFF_WINDOW))) {
      return fail(res, 415, 'not-a-feed', "That URL loaded, but it isn't an RSS feed.");
    }

    applyCors(req, res, { methods: 'GET, OPTIONS' });
    // Forced, not echoed. An upstream text/html served back from our own origin,
    // with its own script tags, is stored XSS on musicsideproject.com.
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).send(text);
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    if (!aborted) console.error('Proxy fetch error:', error);
    return aborted
      ? fail(res, 504, 'timeout', 'The feed host did not respond in time.')
      : fail(res, 502, 'network', 'Could not connect to that address.');
  } finally {
    clearTimeout(timer);
  }
}
