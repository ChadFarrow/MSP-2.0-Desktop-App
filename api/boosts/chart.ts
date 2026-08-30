import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from '../_utils/rateLimiter.js';
import { getClientIp } from '../_utils/urlSafety.js';
import { readAllDerived } from '../_utils/boostStore.js';
import { collapseToPlays, isBoostRecord, topTracks } from '../_utils/boostChart.js';
import { monthKey } from '../_utils/boostRecord.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

/**
 * The public music chart: what listeners played and boosted on feeds made with MSP.
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
 *
 * Public and unauthenticated, so it leans on the CDN: the underlying data changes only
 * when the importer runs, and an hour of staleness on a monthly chart costs nothing.
 */

const RATE_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 };

/** How many rows a single month shows. All-time is uncapped. */
const CHART_SIZE = 10;

/** What a viewer sees. Deliberately narrower than ChartRow — no key, no sats. */
interface PublicRow {
  title: string;
  artist?: string;
  count: number;
}

/** Filter the unnamed out first, then cap — otherwise a top ten can come back short. */
function toPublicRows(records: DerivedBoost[], limit?: number): PublicRow[] {
  const named = topTracks(records).filter(row => row.trackTitle);
  const shown = limit === undefined ? named : named.slice(0, limit);
  return shown.map(row => ({ title: row.trackTitle!, artist: row.trackArtist, count: row.count }));
}

/** `limit` omitted means the whole ranking, which is what the all-time view wants. */
function buildChart(records: DerivedBoost[], limit?: number) {
  const plays = collapseToPlays(records);
  const boosts = records.filter(isBoostRecord);
  // Reported as "streams", not "plays". They are the same thing — one listener's run on
  // a track, collapsed — but "0 plays" reads like something is broken where "0 streams"
  // reads like a fact, and streams is the familiar word for a collapsed listening count.
  return {
    streams: toPublicRows(plays, limit),
    boosts: toPublicRows(boosts, limit),
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
      .map(([month, records]) => ({ month, label: monthLabel(month), ...buildChart(records, CHART_SIZE) }));

    // Short enough that a boost shows up while someone is still looking at the page,
    // long enough that the CDN still absorbs essentially all traffic.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json({
      generatedAt: Date.now(),
      months,
      // No cap: the all-time view is the full ranking, not a top slice.
      allTime: buildChart(mspOnly)
    });
  } catch (error) {
    console.error('Boost chart failed:', error);
    return res.status(500).json({ error: 'Failed to build chart' });
  }
}
