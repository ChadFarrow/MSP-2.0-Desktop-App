import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit } from '../_utils/rateLimiter.js';
import { getClientIp } from '../_utils/urlSafety.js';
import { parseAuthHeader } from '../_utils/adminAuth.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { readAllDerived } from '../_utils/boostStore.js';
import {
  buildIdentity, collapseToPlays, isBoostRecord, isNewIn, songFirstSeen, topArtists, topTracks
} from '../_utils/boostChart.js';
import type { ArtistRow, ChartIdentity, ChartRow } from '../_utils/boostChart.js';
import { BOOSTBOX_CUTOVER, monthKey } from '../_utils/boostRecord.js';
import type { DerivedBoost } from '../_utils/boostRecord.js';

/**
 * The music chart: what listeners played and boosted on feeds made with MSP.
 *
 * **Admin-only for now.** It shipped public in #130; Chad took it private on 2026-09-26
 * while charts are still being worked out. It is gated exactly like coverage.ts, and the
 * response is `private, no-store` — a CDN copy of an authenticated response would be
 * served to anyone. Publishing it again means reverting both, together.
 *
 * Four rules define what may leave this endpoint, and all four are deliberate.
 *
 *   - **MSP splits only.** `isMspSplit` is the whole scope. Everything else on the node
 *     is unrelated income and says nothing about feeds made with MSP.
 *   - **Counts, never amounts.** No sats appear anywhere in this response. The chart is
 *     about what people listened to, not what anyone earned, and publishing per-track
 *     earnings for artists who never agreed to that is not ours to do.
 *   - **Named tracks only.** A row nobody can read is not a chart entry. Records that
 *     resolve to no title are counted in the totals and omitted from the lists.
 *   - **Listeners as a number, never as keys.** A `listenerKey` is a stable pseudonym,
 *     so a list of them is a list of people. Rows and periods publish how many distinct
 *     keys they hold and how many records named no sender (`unattributed`), nothing more.
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
  /** Distinct listeners behind the row: one sender in one app. */
  listeners: number;
  /** Records in the row that named no sender, so they reach no listener count. */
  unattributed: number;
  /** Other artist spellings merged into this row (see mergeAliases); absent when none. */
  mergedFrom?: string[];
  /** First supported in this month. Month views only, and absent rather than false. */
  isNew?: true;
  /** Count per month along `trend.months`. All time only. */
  trend?: number[];
}

interface PublicArtistRow {
  artist: string;
  count: number;
  songs: number;
  listeners: number;
  unattributed: number;
  /** Album-only labels given to this artist (see albumArtists); absent when none. */
  mergedFrom?: string[];
  isNew?: true;
  trend?: number[];
}

/**
 * Every named track, ranked. Nothing is capped.
 *
 * A top ten was hiding real data rather than tidying it: measured across the live months
 * it truncated 5 of 16 lists, and June's boosted list showed 10 of its 28 tracks. The
 * longest month is 28 rows and all-time is already 62, so there is nothing here a cap
 * protects a reader from.
 */
function toPublicRows(rows: ChartRow[], isNew: (row: ChartRow) => boolean, axis?: string[]): PublicRow[] {
  return rows
    .filter(row => row.trackTitle)
    .map(row => ({
      title: row.trackTitle!,
      artist: row.trackArtist,
      count: row.count,
      listeners: row.listenerKeys.size,
      unattributed: row.unattributed,
      ...(row.mergedFrom ? { mergedFrom: row.mergedFrom } : {}),
      ...(isNew(row) ? { isNew: true as const } : {}),
      ...(axis ? { trend: axis.map(month => row.byMonth.get(month) ?? 0) } : {})
    }));
}

function toPublicArtists(rows: ArtistRow[], isNew: (row: ArtistRow) => boolean, axis?: string[]): PublicArtistRow[] {
  return rows.map(row => ({
    artist: row.artist,
    count: row.count,
    songs: row.songs,
    listeners: row.listenerKeys.size,
    unattributed: row.unattributed,
    ...(row.mergedFrom ? { mergedFrom: row.mergedFrom } : {}),
    ...(isNew(row) ? { isNew: true as const } : {}),
    ...(axis ? { trend: axis.map(month => row.byMonth.get(month) ?? 0) } : {})
  }));
}

/**
 * One period's chart. A month view marks rows new; all time instead gives each row its
 * count per month along `axis`, because one month has no trend to show.
 */
function buildChart(
  records: DerivedBoost[],
  identity: ChartIdentity,
  view: { month: string } | { axis: string[] }
) {
  const month = 'month' in view ? view.month : undefined;
  const axis = 'axis' in view ? view.axis : undefined;
  const plays = collapseToPlays(records);
  const boosts = records.filter(isBoostRecord);
  const streamRows = topTracks(plays);
  const boostRows = topTracks(boosts);

  const songIsNew = (row: ChartRow) =>
    month !== undefined && isNewIn(month, songFirstSeen(row, identity), identity);
  const artistIsNew = (row: ArtistRow) =>
    month !== undefined && isNewIn(month, identity.artistFirstTs.get(row.artistKey) ?? row.firstTs, identity);

  // The period counts what its totals count — every play and boost, named or not.
  const counted = [...plays, ...boosts];
  const listeners = new Set(counted.flatMap(r => (r.listenerKey ? [r.listenerKey] : [])));

  // Reported as "streams", not "plays". They are the same thing — one listener's run on
  // a track, collapsed — but "0 plays" reads like something is broken where "0 streams"
  // reads like a fact, and streams is the familiar word for a collapsed listening count.
  return {
    streams: toPublicRows(streamRows, songIsNew, axis),
    boosts: toPublicRows(boostRows, songIsNew, axis),
    artistStreams: toPublicArtists(topArtists(streamRows, identity.albums), artistIsNew, axis),
    artistBoosts: toPublicArtists(topArtists(boostRows, identity.albums), artistIsNew, axis),
    totalStreams: plays.length,
    totalBoosts: boosts.length,
    listeners: listeners.size,
    unattributed: counted.filter(r => !r.listenerKey).length
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

/** The month after `month`, both `YYYY-MM`. */
function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Every month from the first with data to this month, with none skipped. A month with no
 * support is a zero on the graph, not a gap — a gap would join the months either side and
 * hide the quiet one. It runs to this month even when this month has nothing yet, and past
 * it if a record is dated later.
 */
function trendAxis(dataMonths: string[]): string[] {
  if (dataMonths.length === 0) return [];
  const sorted = [...dataMonths].sort();
  const thisMonth = monthKey(Math.floor(Date.now() / 1000));
  const last = sorted[sorted.length - 1] > thisMonth ? sorted[sorted.length - 1] : thisMonth;
  const axis = [sorted[0]];
  while (axis[axis.length - 1] < last) axis.push(nextMonth(axis[axis.length - 1]));
  return axis;
}

/**
 * The first month whose counts are complete. Before msp-bot took over (BOOSTBOX_CUTOVER,
 * 2026-01-29) the records are Helipad's, and Helipad missed LNURL boosts — 87 of 339
 * measured afterwards. The cutover month itself is mostly Helipad's, so it is not complete
 * either. The page says so, or the graph shows growth that is only a change of source.
 */
const COMPLETE_FROM = nextMonth(monthKey(BOOSTBOX_CUTOVER));

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
    const identity = buildIdentity(mspOnly);

    const byMonth = new Map<string, DerivedBoost[]>();
    for (const record of mspOnly) {
      const month = monthKey(record.ts);
      const bucket = byMonth.get(month);
      if (bucket) bucket.push(record);
      else byMonth.set(month, [record]);
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, records]) => ({ month, label: monthLabel(month), ...buildChart(records, identity, { month }) }));

    const axis = trendAxis([...byMonth.keys()]);
    const byKey = new Map(months.map(m => [m.month, m]));
    const trend = {
      months: axis,
      boosts: axis.map(m => byKey.get(m)?.totalBoosts ?? 0),
      streams: axis.map(m => byKey.get(m)?.totalStreams ?? 0),
      listeners: axis.map(m => byKey.get(m)?.listeners ?? 0),
      completeFrom: COMPLETE_FROM
    };

    return res.status(200).json({
      generatedAt: Date.now(),
      months,
      allTime: buildChart(mspOnly, identity, { axis }),
      trend
    });
  } catch (error) {
    console.error('Boost chart failed:', error);
    return res.status(500).json({ error: 'Failed to build chart' });
  }
}
