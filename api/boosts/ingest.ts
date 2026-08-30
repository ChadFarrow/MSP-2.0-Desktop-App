import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from '../_utils/rateLimiter.js';
import { getClientIp } from '../_utils/urlSafety.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { parseBoostPayload, isHelipadTestBoost } from '../_utils/boostRecord.js';
import type { ParsedBoost } from '../_utils/boostRecord.js';
import { isBoostStoreConfigured, storeBoosts } from '../_utils/boostStore.js';

/**
 * Ingest for Helipad boost records.
 *
 * Helipad posts here from a trigger configured with a webhook URL and token; it sends
 * `Authorization: Bearer <token>` (its src/triggers.rs). Three properties of that
 * caller shape this handler:
 *
 *   - It counts a delivery successful only on HTTP exactly 200. Not 201, not 204.
 *   - It never retries. A non-200 loses that boost from this path permanently, which
 *     is why tools/import-helipad.mjs exists and is re-runnable.
 *   - It follows at most 5 redirects, so the trigger must point at the canonical host.
 *
 * The same endpoint takes an array from the import script, so one parser serves both
 * and history and live traffic can never drift apart.
 */

/** Bounded so one request can't hold a function open writing thousands of blobs. */
const MAX_BATCH = 200;

const RATE_LIMIT = { limit: 600, windowMs: 60 * 60 * 1000 };

/**
 * Vercel parses a JSON body for us, but a delivery Helipad never retries is not the
 * place to depend on that. A body that arrives as a raw string is parsed here rather
 * than rejected, because a 400 would drop that boost for good.
 */
function coerceBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedToken = process.env.HELIPAD_WEBHOOK_TOKEN;

  // 404 rather than 401 when unconfigured: until both env vars are set the feature
  // does not exist, and saying so invites nobody to guess at the token.
  if (!expectedToken || !isBoostStoreConfigured()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const authHeader = req.headers['authorization'];
  const presented = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  // Constant-time, and the string variant on purpose: timingSafeEqualHex would run
  // Buffer.from(x, 'hex') over a free-form secret and compare two truncations equal.
  if (!presented || !timingSafeEqualString(presented, expectedToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Namespaced key — the limiter is one shared Map, so an unprefixed key would share
  // a bucket with every other unprefixed caller.
  const rate = checkRateLimit(`boost-ingest:${getClientIp(req)}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const body: unknown = coerceBody(req.body);
  const payloads: unknown[] = Array.isArray(body) ? body : [body];

  if (payloads.length === 0) {
    return res.status(400).json({ error: 'Empty payload' });
  }
  if (payloads.length > MAX_BATCH) {
    return res.status(400).json({ error: `Batch too large, maximum ${MAX_BATCH}` });
  }

  const entries: { parsed: ParsedBoost; payload: unknown }[] = [];
  let skipped = 0;
  let tests = 0;
  for (const payload of payloads) {
    const parsed = parseBoostPayload(payload);
    if (!parsed) { skipped += 1; continue; }
    // Accepted and acknowledged, never stored — see isHelipadTestBoost.
    if (isHelipadTestBoost(parsed)) { tests += 1; continue; }
    entries.push({ parsed, payload });
  }

  // A trigger test carries nothing else, and its whole purpose is to prove the path
  // works. Answer 200 so Helipad reports success, having stored nothing.
  if (entries.length === 0 && tests > 0) {
    return res.status(200).json({ ok: true, written: 0, duplicates: 0, weeks: [], skipped, tests });
  }

  // Nothing usable is worth surfacing: Helipad records the failed status against the
  // trigger, which is the only place a malformed payload would otherwise be visible.
  if (entries.length === 0) {
    return res.status(400).json({ error: 'No records carried a usable index' });
  }

  try {
    const result = await storeBoosts(entries, Array.isArray(body) ? 'import' : 'webhook');
    // Exactly 200. Helipad treats anything else as a failed delivery.
    return res.status(200).json({ ok: true, ...result, skipped, tests });
  } catch (error) {
    console.error('Boost ingest failed:', error);
    return res.status(500).json({ error: 'Failed to store boost' });
  }
}
