import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from '../_utils/rateLimiter.js';
import { getClientIp } from '../_utils/urlSafety.js';
import { parseAuthHeader } from '../_utils/adminAuth.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { readAllDerived } from '../_utils/boostStore.js';
import { collapseToPlays, isBoostRecord, topTracks } from '../_utils/boostChart.js';
import { monthKey } from '../_utils/boostRecord.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

/**
 * The music chart: what listeners played and boosted on feeds made with MSP.
 *
 * **Admin-only for now.** It shipped public in #130; Chad took it private on 2026-09-26
 * while charts are still being worked out. It is gated exactly like coverage.ts, and the
 * response is `private, no-store` — a CDN copy of an authenticated response would be
 * served to anyone. Publishing it again means reverting both, together.
 *
 * Three rules define what may leave this endpoint, and all three are deliberate.
 *
 *   - **MSP splits only.** `isMspSplit` is the whole scope. Everything else on the node
 *     is unrelated income and says nothing about feeds made with MSP.
 *   - **Counts, never amounts.** No sats appear anywhere in this response. The chart is
 *     about what people listened to, not what anyone earned, and publishing per-track
 *     earnings for artists who never agreed to that is not ours to do.
 *   - **Named tracks only.** A row nobody can read is not a chart entry. Records that
 *     resolve to no title are counted in the totals and omitted from the lists.
 *
 * It reads the derived projection, which carries no listener message, sender name or
 * sender id, so no amount of aggregation here can leak one.
 */

const RATE_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 };

/** What a viewer sees. Deliberately narrower than ChartRow — no key, no sats. */
interface PublicRow {
  title: string;
  artist?: string;
  count: number;
}

/**
 * Every named track, ranked. Nothing is capped.
 *
 * A top ten was hiding real data rather than tidying it: measured across the live months
 * it truncated 5 of 16 lists, and June's boosted list showed 10 of its 28 tracks. The
 * longest month is 28 rows and all-time is already 62, so there is nothing here a cap
 * protects a reader from.
 */
function toPublicRows(records: DerivedBoost[]): PublicRow[] {
  return topTracks(records)
    .filter(row => row.trackTitle)
    .map(row => ({ title: row.trackTitle!, artist: row.trackArtist, count: row.count }));
}

function buildChart(records: DerivedBoost[]) {
  const plays = collapseToPlays(records);
  const boosts = records.filter(isBoostRecord);
  // Reported as "streams", not "plays". They are the same thing — one listener's run on
  // a track, collapsed — but "0 plays" reads like something is broken where "0 streams"
  // reads like a fact, and streams is the familiar word for a collapsed listening count.
  return {
    streams: toPublicRows(plays),
    boosts: toPublicRows(boosts),
    totalStreams: plays.length,
    totalBoosts: boosts.length
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${year}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Namespaced key — the limiter is one shared Map, so an unprefixed key would share
  // a bucket with every other unprefixed caller.
  const rate = checkRateLimit(`boost-chart:${getClientIp(req)}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  // Set before the auth check, so a refusal is not cached for a later admin either.
  res.setHeader('Cache-Control', 'private, no-store');

  const adminKey = req.headers['x-admin-key'];
  const hasLegacyAdmin = !!process.env.MSP_ADMIN_KEY && typeof adminKey === 'string' &&
    timingSafeEqualString(adminKey, process.env.MSP_ADMIN_KEY);
  const nostrAdmin = await parseAuthHeader(req.headers['authorization'] as string | undefined);

  if (!hasLegacyAdmin && !nostrAdmin.valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const mspOnly = (await readAllDerived()).filter(r => r.isMspSplit);

    const byMonth = new Map<string, DerivedBoost[]>();
    for (const record of mspOnly) {
      const month = monthKey(record.ts);
      const bucket = byMonth.get(month);
      if (bucket) bucket.push(record);
      else byMonth.set(month, [record]);
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, records]) => ({ month, label: monthLabel(month), ...buildChart(records) }));

    return res.status(200).json({
      generatedAt: Date.now(),
      months,
      allTime: buildChart(mspOnly)
    });
  } catch (error) {
    console.error('Boost chart failed:', error);
    return res.status(500).json({ error: 'Failed to build chart' });
  }
}
