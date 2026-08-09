import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from './_utils/rateLimiter.js';
import { getFeedUrlError, normalizeFeedUrl } from './_utils/urlValidation.js';
import { getClientIp } from './_utils/urlSafety.js';

/**
 * Check whether a podping for a feed URL actually landed on the Hive blockchain.
 *
 * /api/podping only confirms that the hivepinger service *accepted* a ping into its
 * queue — hivepinger broadcasts to Hive asynchronously. This endpoint closes that gap
 * by scanning the MSP Hive account's recent custom_json ops for the feed URL.
 *
 * GET /api/podping-verify?url=<feedUrl>&since=<epochMs>
 * → { landed: boolean, account, trxId?, block?, timestamp? }
 *
 * `since` is what makes this answer "did the ping I just sent land?" rather than the
 * far weaker "has this feed ever been podpinged?". Without it, a feed pinged an hour
 * (or a month) ago reports landed:true on the first poll and stops looking.
 */

const RATE_LIMIT = { limit: 60, windowMs: 3600_000 };

// The frontend polls this endpoint several times per send, so it gets its own
// (higher) budget. The rate limiter is keyed by string, and /api/podping keys on the
// bare IP — prefixing keeps the two endpoints from sharing a bucket.
const RATE_LIMIT_PREFIX = 'podping-verify:';

const DEFAULT_RPC_NODES = ['https://api.hive.blog', 'https://api.deathwing.me'];

// Podpings are the MSP account's only regular activity, so a shallow window is plenty
// — 100 ops currently reaches back about two months.
const HISTORY_LIMIT = 100;

// Tolerance between the browser's clock (which stamps `since`) and Hive block times.
const SINCE_SKEW_MS = 60_000;

interface CustomJsonPayload {
  id?: string;
  json?: string;
}

interface HistoryValue {
  trx_id?: string;
  block?: number;
  timestamp?: string;
  op?: [string, CustomJsonPayload];
}

interface Landing {
  trxId?: string;
  block?: number;
  timestamp?: string;
}

function getRpcNodes(): string[] {
  const override = process.env.PODPING_HIVE_RPC_URL;
  return override ? [override] : DEFAULT_RPC_NODES;
}

/** Fetch the account's recent history from one node. Throws if the node is unusable. */
async function fetchAccountHistory(node: string, account: string): Promise<unknown[]> {
  const response = await fetch(node, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'condenser_api.get_account_history',
      params: [account, -1, HISTORY_LIMIT],
      id: 1
    })
  });

  if (!response.ok) {
    throw new Error(`Hive node ${node} returned ${response.status}`);
  }

  const data = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (data?.error) {
    throw new Error(data.error.message ?? `Hive node ${node} returned an RPC error`);
  }
  if (!Array.isArray(data?.result)) {
    throw new Error(`Hive node ${node} returned an unexpected payload`);
  }

  return data.result;
}

/** Hivepinger writes op ids as `pp_<medium>_<reason>`; older tooling used a bare `podping`. */
function isPodpingOpId(id: unknown): boolean {
  return typeof id === 'string' && (id === 'podping' || id.startsWith('pp_'));
}

/** `since` is epoch ms from the browser. Anything unparseable is treated as absent. */
function parseSince(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Hive timestamps are UTC but carry no zone marker, so append one before parsing. */
function opTimeMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(`${timestamp}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Find the newest podping op whose payload mentions the feed URL.
 *
 * The match is a substring test against the raw json string on purpose: it is agnostic
 * to the `iris` (v1.1) vs legacy `urls` key, and it still matches when hivepinger
 * batches several feed URLs into a single op. JSON encoders don't escape `/`, so the
 * URL appears verbatim.
 *
 * `minTimeMs` (when set) rejects ops older than the caller's send time, so a previous
 * ping for the same feed can't be mistaken for the current one.
 */
function findLanding(
  entries: unknown[],
  feedUrl: string,
  minTimeMs: number | null
): Landing | null {
  // condenser_api returns history oldest-first — walk backwards for the newest match.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!Array.isArray(entry)) continue;

    const value = entry[1] as HistoryValue | undefined;
    const op = value?.op;
    if (!Array.isArray(op) || op[0] !== 'custom_json') continue;

    const payload = op[1];
    if (!payload || !isPodpingOpId(payload.id)) continue;
    if (typeof payload.json !== 'string' || !payload.json.includes(feedUrl)) continue;

    if (minTimeMs !== null) {
      const opMs = opTimeMs(value?.timestamp);
      if (opMs === null || opMs < minTimeMs) continue;
    }

    return { trxId: value?.trx_id, block: value?.block, timestamp: value?.timestamp };
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: rawUrl, since } = req.query as { url?: string; since?: string };

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Strip paste whitespace before validating — see the note in pubnotify.ts. This
  // also keeps the Hive payload match below comparing the same string the
  // podping was sent with.
  const url = normalizeFeedUrl(rawUrl);
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const urlError = getFeedUrlError(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(`${RATE_LIMIT_PREFIX}${ip}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many verification requests. Try again later.' });
  }

  const account = process.env.PODPING_HIVE_ACCOUNT;
  if (!account) {
    return res.status(501).json({ error: 'Hive verification not configured' });
  }

  const sinceMs = parseSince(since);
  const minTimeMs = sinceMs === null ? null : sinceMs - SINCE_SKEW_MS;

  let lastError: Error | null = null;
  for (const node of getRpcNodes()) {
    try {
      const entries = await fetchAccountHistory(node, account);
      const landing = findLanding(entries, url, minTimeMs);

      if (!landing) {
        return res.status(200).json({ landed: false, account });
      }

      return res.status(200).json({
        landed: true,
        account,
        trxId: landing.trxId,
        block: landing.block,
        timestamp: landing.timestamp
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Hive verification via ${node} failed: ${lastError.message}`);
    }
  }

  // Every node failed — report that we couldn't check, never that the ping didn't land.
  return res.status(502).json({
    error: lastError?.message ?? 'Could not reach any Hive node'
  });
}
