import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from '../_utils/rateLimiter.js';
import { getClientIp } from '../_utils/urlSafety.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { parseBoostPayload, isHelipadTestBoost, isMspSplit, isoWeekKey } from '../_utils/boostRecord.js';
import type { BoostSource, ParsedBoost } from '../_utils/boostRecord.js';
import {
  isBoostStoreConfigured,
  storeRawBoosts,
  replaceDerivedWeek,
  rebuildWeekFromRaw,
  readStoredBoostboxRecords
} from '../_utils/boostStore.js';
import { enrichWithRemoteTitles } from '../_utils/remoteItemLookup.js';

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
 * Two body shapes, and the difference matters:
 *
 *   A single record, or a bare array   -> raw records only.
 *   { week, records: [...] }           -> raw records, plus that week's derived file
 *                                         rewritten from the records supplied.
 *
 * The second form requires `records` to be the COMPLETE set for that week, because the
 * derived file is replaced outright rather than merged. That is deliberate: merging
 * would mean reading the previous version first, and a Vercel Blob read is served from
 * a CDN with a 60-second floor, so at import cadence the read is stale and the merge
 * silently truncates the week. Writing whole removes the read, and with it the bug.
 *
 * A live webhook cannot know a whole week, so it writes raw only and the chart catches
 * up on the next importer run. Raw is the source of truth and is always complete.
 *
 * A second caller, msp-bot (boostbox), posts the same record shape with
 * `source: "boostbox"` and a `payment_hash` in place of `index`, under its own
 * MSP_BOT_INGEST_TOKEN. Since 2026-09-26 it is the chart's live source; Helipad's
 * records count only before BOOSTBOX_CUTOVER (see boostRecord.ts). It sends single
 * records or arrays only: the week envelope is refused under its token, and so is any
 * record that is not the MSP split.
 */

/**
 * Records per request. Raw writes run concurrently, but a request still has to fit
 * Vercel's default function timeout, and the largest real week measured was 363.
 */
const MAX_BATCH = 500;

const RATE_LIMIT = { limit: 600, windowMs: 60 * 60 * 1000 };

const WEEK_RE = /^\d{4}-W\d{2}$/;

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

  const helipadToken = process.env.HELIPAD_WEBHOOK_TOKEN;
  const botToken = process.env.MSP_BOT_INGEST_TOKEN;

  // 404 rather than 401 when unconfigured: until a token and the namespace are set the
  // feature does not exist, and saying so invites nobody to guess at a token.
  if ((!helipadToken && !botToken) || !isBoostStoreConfigured()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const authHeader = req.headers['authorization'];
  const presented = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  // Constant-time, and the string variant on purpose: timingSafeEqualHex would run
  // Buffer.from(x, 'hex') over a free-form secret and compare two truncations equal.
  // Each token names its caller, and a caller may only write its own source's records.
  const caller: BoostSource | null =
    presented && helipadToken && timingSafeEqualString(presented, helipadToken) ? 'helipad'
    : presented && botToken && timingSafeEqualString(presented, botToken) ? 'boostbox'
    : null;

  if (!caller) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Namespaced key — the limiter is one shared Map, so an unprefixed key would share
  // a bucket with every other unprefixed caller.
  const rate = checkRateLimit(`boost-ingest:${getClientIp(req)}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const body = coerceBody(req.body);

  let week: string | null = null;
  let payloads: unknown[];

  if (body && typeof body === 'object' && !Array.isArray(body) && 'records' in body) {
    const envelope = body as { week?: unknown; records?: unknown };
    if (typeof envelope.week !== 'string' || !WEEK_RE.test(envelope.week)) {
      return res.status(400).json({ error: 'week must be an ISO week key, e.g. 2026-W35' });
    }
    if (!Array.isArray(envelope.records)) {
      return res.status(400).json({ error: 'records must be an array' });
    }
    // The envelope rewrites the whole week from the records supplied plus the bot's
    // stored ones, so only Helipad's importer may send it: a bot-token envelope would
    // write that week with every Helipad record gone. The bot never needs it.
    if (caller !== 'helipad') {
      return res.status(400).json({ error: 'The week envelope is for the Helipad importer only' });
    }
    week = envelope.week;
    payloads = envelope.records;
  } else {
    payloads = Array.isArray(body) ? body : [body];
  }

  if (payloads.length === 0) {
    return res.status(400).json({ error: 'Empty payload' });
  }
  if (payloads.length > MAX_BATCH) {
    return res.status(400).json({ error: `Batch too large, maximum ${MAX_BATCH}` });
  }

  let entries: { parsed: ParsedBoost; payload: unknown }[] = [];
  let skipped = 0;
  let tests = 0;
  for (const payload of payloads) {
    const parsed = parseBoostPayload(payload);
    if (!parsed) { skipped += 1; continue; }
    // A leaked bot token must not be able to forge Helipad history, nor the reverse.
    if (parsed.source !== caller) { skipped += 1; continue; }
    // A bot with a wrong BBN_RECIPIENT_NAMES must not put another show's listener
    // messages into MSP's raw store. Helipad's records are all kept, as they always were.
    if (parsed.source === 'boostbox' && !isMspSplit(parsed)) { skipped += 1; continue; }
    // Accepted and acknowledged, never stored — see isHelipadTestBoost.
    if (isHelipadTestBoost(parsed)) { tests += 1; continue; }
    entries.push({ parsed, payload });
  }

  // A trigger test carries nothing else, and its whole purpose is to prove the path
  // works. Answer 200 so Helipad reports success, having stored nothing.
  if (entries.length === 0 && tests > 0) {
    return res.status(200).json({ ok: true, written: 0, duplicates: 0, weekSizes: {}, skipped, tests });
  }

  // Nothing usable is worth surfacing: Helipad records the failed status against the
  // trigger, which is the only place a malformed payload would otherwise be visible.
  if (entries.length === 0) {
    return res.status(400).json({ error: 'No records carried a usable index' });
  }

  // A record that does not belong to the stated week would be dropped by the rewrite
  // without trace, so refuse rather than silently lose it.
  if (week) {
    const strays = entries.filter(e => isoWeekKey(e.parsed.ts) !== week);
    if (strays.length > 0) {
      return res.status(400).json({
        error: `${strays.length} record(s) are not in ${week}`,
        example: isoWeekKey(strays[0].parsed.ts)
      });
    }
  }

  // Helipad resolves a remote item's titles itself; for msp-bot's records MSP does it
  // here, before the raw write, so the resolver's remote-guid rung keeps its names.
  entries = await enrichWithRemoteTitles(entries);

  try {
    const result = await storeRawBoosts(entries, week ? 'import' : caller === 'boostbox' ? 'boostbox' : 'webhook');
    const weekSizes: Record<string, number> = {};

    if (week) {
      // The importer supplies Helipad's records only. The bot's stored records for the
      // week go into the same whole-week write, or re-running the importer would drop
      // them from the chart.
      const stored = await readStoredBoostboxRecords(week);
      weekSizes[week] = await replaceDerivedWeek(week, [...entries.map(e => e.parsed), ...stored]);
    } else {
      // A webhook knows one boost, not a week — so rebuild that week from raw, which
      // needs no previous version of the derived file and therefore no merge. The
      // records just received are passed through as well: list() may not yet show the
      // blob written a moment ago, and rebuilding purely from the listing could drop
      // the very boost that triggered this.
      const byWeek = new Map<string, ParsedBoost[]>();
      for (const entry of entries) {
        const key = isoWeekKey(entry.parsed.ts);
        const bucket = byWeek.get(key);
        if (bucket) bucket.push(entry.parsed);
        else byWeek.set(key, [entry.parsed]);
      }
      for (const [key, records] of byWeek) {
        const size = await rebuildWeekFromRaw(key, records);
        if (size !== null) weekSizes[key] = size;
      }
    }
    // Exactly 200. Helipad treats anything else as a failed delivery.
    return res.status(200).json({ ok: true, ...result, weekSizes, skipped, tests });
  } catch (error) {
    console.error('Boost ingest failed:', error);
    return res.status(500).json({ error: 'Failed to store boost' });
  }
}
