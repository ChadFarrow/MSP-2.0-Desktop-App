// The submit guard: stop MSP reporting success for a feed no crawler can fetch.
//
// A user published a feed behind Cloudflare Bot Fight Mode. Podcast Index went to
// crawl it, got a 403, and recorded the feed with lastGoodHttpStatusTime: 0 —
// registered, permanently blank, never indexed. MSP said "✅ Submitted!" every
// time, because from MSP's side nothing had failed.
//
// The advisory check in src/utils/verifyFeedUrl.ts warns next to the six URL
// fields a user can type into. This guard covers the submit paths themselves,
// including the automatic ones (post-hosting pings, the nsite follow-up,
// publisherPublish) where there is no field and no user to warn.
import { checkRateLimit } from './rateLimiter.js';
import { probeFeedUrl, GUARD_TIMEOUT_MS } from './feedProbe.js';

/** Status-and-verdict only — never anything derived from the response body. */
export interface GuardReachability {
  ok: false;
  status: number | null;
  looksLikeFeed: boolean;
  reason: 'blocked';
}

export interface GuardRefusal {
  error: string;
  reachability: GuardReachability;
}

const MSP_HOSTS = ['musicsideproject.com', 'msp.podtards.com'];

/**
 * True for feeds MSP serves itself — no point probing our own blob storage.
 *
 * Matches the hosted *path* as well as the known hosts: buildHostedUrl derives
 * its origin from VITE_CANONICAL_URL, so on a preview deploy a hosted feed lives
 * at some *.vercel.app address the host list would miss, and every hosted save
 * would have MSP probing itself.
 */
export function isMspHostedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  // Suffix match must include the dot, or "notmusicsideproject.com" matches.
  if (MSP_HOSTS.some((known) => host === known || host.endsWith(`.${known}`))) {
    return true;
  }

  return parsed.pathname.startsWith('/api/hosted/');
}

/** Accepts the shapes a query param and a JSON body arrive in. */
export function wantsForce(value: unknown): boolean {
  return value === true || value === '1' || value === 'true';
}

/**
 * Two outbound fetches per submit on endpoints that previously made none, and
 * pubnotify/pisubmit have no rate limit of their own — without a cap they become
 * an unauthenticated "fetch any public URL and tell me what happened" service.
 * Exhaustion skips the probe rather than refusing: a budget that could block a
 * legitimate submit would be worse than the bug this guard fixes.
 */
const PROBE_BUDGET = { limit: 60, windowMs: 3600_000 };

/**
 * Returns a refusal to send back as HTTP 400, or null to let the submit proceed.
 *
 * Refuses ONLY on a confirmed block (401/403/429). Timeouts, DNS failures, 5xx
 * and HTML-instead-of-RSS all fail open — the probe being wrong, or Vercel's
 * egress being unhappy, must never stop someone submitting a feed that is fine.
 */
export async function guardFeedSubmission(
  url: string,
  options: { force?: boolean; clientIp?: string } = {}
): Promise<GuardRefusal | null> {
  if (options.force || isMspHostedUrl(url)) return null;

  if (options.clientIp) {
    const rate = checkRateLimit(`feed-guard:${options.clientIp}`, PROBE_BUDGET);
    if (!rate.allowed) return null;
  }

  const { verdict, outcome } = await probeFeedUrl(url, { timeoutMs: GUARD_TIMEOUT_MS });

  if (verdict !== 'blocked') return null;

  return {
    error:
      `This feed can't be reached — your host returned ${outcome.status ?? 'an error'} to our crawler. ` +
      `Podcast Index would be blocked the same way, so submitting now would register a feed that never indexes. ` +
      `Check your bot protection (Cloudflare: Security → Bots) or firewall rules, then try again.`,
    reachability: {
      ok: false,
      status: outcome.status ?? null,
      looksLikeFeed: Boolean(outcome.looksLikeFeed),
      reason: 'blocked'
    }
  };
}
