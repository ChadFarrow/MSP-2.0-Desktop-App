// Mechanism shared by every endpoint that fetches a user-supplied URL: redirect
// following with assertPublicHttpUrl on EVERY hop, and a byte-capped body read.
//
// This module makes no policy decisions. It does not decide what counts as a
// successful fetch — a 503 comes back as ok:true, because "we completed a
// request" is mechanism and "503 means server-error" is policy — and it never
// decides whether a body may be returned to a caller. /api/verify-feed-url's
// no-bytes guarantee lives in feedProbe.ts; /api/proxy-feed's size and shape
// rules live in proxy-feed.ts. Keep it that way: a policy decision made here
// would apply to both callers, and they differ on purpose.
import { assertPublicHttpUrl, type UrlSafetyResult } from './urlSafety.js';

export const MAX_REDIRECTS = 5;
export const FEED_MARKERS = ['<rss', '<feed', '<channel'];

type SafetyFailure = Extract<UrlSafetyResult, { ok: false }>;

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; kind: 'unsafe'; hop: number; safety: SafetyFailure; reason: string }
  | { ok: false; kind: 'no-location'; status: number; reason: string }
  | { ok: false; kind: 'too-many-redirects'; reason: string };

export interface SafeFetchOptions {
  signal: AbortSignal;
  headers: Record<string, string>;
  /**
   * Set when the caller already ran assertPublicHttpUrl on startUrl itself.
   * probeFeedUrl does: one preflight shared by its two parallel walks, so they
   * don't each repeat the DNS lookup, and so a blocked *first* hop stays
   * distinguishable from a redirect into one.
   */
  startAlreadyChecked?: boolean;
  maxRedirects?: number;
}

/**
 * Follow redirects by hand so every hop gets the SSRF check.
 *
 * `redirect: 'manual'` is load-bearing. With 'follow' a public URL can bounce to
 * 169.254.169.254 behind our back — the per-hop check only sees hops we walk
 * ourselves.
 */
export async function safeFetchFollow(
  startUrl: string,
  options: SafeFetchOptions
): Promise<SafeFetchResult> {
  const max = options.maxRedirects ?? MAX_REDIRECTS;
  let current = startUrl;

  for (let hop = 0; hop <= max; hop++) {
    if (hop > 0 || !options.startAlreadyChecked) {
      const safety = await assertPublicHttpUrl(current);
      if (!safety.ok) {
        return {
          ok: false,
          kind: 'unsafe',
          hop,
          safety,
          reason: hop === 0 ? safety.error : `Redirected to a blocked address (${safety.error})`
        };
      }
    }

    const response = await fetch(current, {
      redirect: 'manual',
      signal: options.signal,
      headers: options.headers
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          kind: 'no-location',
          status: response.status,
          reason: 'Redirect with no destination'
        };
      }
      const next = new URL(location, current);
      // Strip userinfo before following. Node's fetch turns https://user:pass@host
      // into an Authorization header, and new URL(location, current) carries
      // userinfo straight through — so a caller that rejects credentials on the
      // URL it was handed (proxy-feed does) is still a credential relay one
      // redirect later. assertPublicHttpUrl never looks at these fields, so this
      // is the only place it can be caught for every caller at once.
      next.username = '';
      next.password = '';
      current = next.toString();
      continue;
    }

    return { ok: true, response, finalUrl: current };
  }

  return { ok: false, kind: 'too-many-redirects', reason: 'Too many redirects' };
}

export interface CappedRead {
  text: string;
  /**
   * True when the body ran past maxBytes. A caller that *returns* the bytes must
   * refuse on this rather than serve a truncated feed — half an XML document
   * parses as a corrupt one, not as a short one.
   */
  truncated: boolean;
}

/** Read at most maxBytes of the body, then abort the transfer. */
export async function readCapped(response: Response, maxBytes: number): Promise<CappedRead> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = '';
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
      // Read one chunk *past* the cap rather than stopping at it, so "exactly
      // maxBytes" is distinguishable from "maxBytes and more to come".
      //
      // NOTE — this is the one place the extraction from feedProbe is NOT
      // behaviour-preserving, whatever the passing test count suggests. The
      // original checked `text.length < maxBytes` *before* each read, so the cap
      // was measured purely in UTF-16 code units; this also counts raw bytes.
      // For multi-byte UTF-8 that stops earlier in character terms — a 64 KB
      // sniff over 3-byte characters now yields ~21.8k chars where it used to
      // yield ~65.5k. Nothing depends on it today (feed markers live in the
      // first few hundred bytes, and every existing test still passes), but the
      // byte count is what a caller returning the bytes actually needs, so it
      // stays. Don't cite "the tests didn't change" as proof that nothing did.
      if (bytes > maxBytes || text.length > maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    // cancel(), not a drain: stop the transfer instead of paying for the rest.
    await reader.cancel().catch(() => {});
  }
  return { text: text.slice(0, maxBytes), truncated };
}

export function looksLikeFeedText(text: string): boolean {
  return FEED_MARKERS.some((marker) => text.includes(marker));
}
