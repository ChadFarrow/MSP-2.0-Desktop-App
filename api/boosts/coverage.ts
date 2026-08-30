import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseAuthHeader } from '../_utils/adminAuth.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { readAllDerived } from '../_utils/boostStore.js';
import { collapseToPlays, isBoostRecord, topTracks } from '../_utils/boostChart.js';
import { isoWeekKey } from '../_utils/boostRecord.js';
import type { DerivedBoost, TrackSource } from '../_utils/boostRecord.js';

/**
 * The phase 1 deliverable: how well can a boost be resolved to an actual track?
 *
 * Returns counts only. It reads the derived projection, which carries no listener
 * message, sender name or sender id — so nothing here can leak one even by accident.
 * Never make this endpoint return a raw record.
 *
 * Admin-gated the same way GET /api/hosted/ is. Note the NIP-98 weakness CLAUDE.md
 * records (events are unbound to URL and method): acceptable here because the
 * endpoint is read-only and returns aggregates, but it is not a reason to relax it.
 */

const TRACK_SOURCES: TrackSource[] = [
  'remote-guid',
  'remote-title',
  'boost-link',
  'timesplit',
  'message',
  'none'
];

/** Sources that produce a stable key, i.e. ones a Top 10 could actually count on. */
const KEYED_SOURCES = new Set<TrackSource>(['remote-guid', 'remote-title', 'boost-link', 'message']);

function tally<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function summarize(records: DerivedBoost[], withCharts: boolean) {
  const bySource: Record<string, number> = {};
  for (const source of TRACK_SOURCES) bySource[source] = 0;
  for (const record of records) bySource[record.trackSource] += 1;

  const byWeek = new Map<string, { week: string; boosts: number; tracks: Set<string>; satsTotal: number }>();
  for (const record of records) {
    const week = isoWeekKey(record.ts);
    let bucket = byWeek.get(week);
    if (!bucket) {
      bucket = { week, boosts: 0, tracks: new Set(), satsTotal: 0 };
      byWeek.set(week, bucket);
    }
    bucket.boosts += 1;
    bucket.satsTotal += Math.round(record.valueMsatTotal / 1000);
    if (record.trackKey) bucket.tracks.add(record.trackKey);
  }

  const distinctTracks = new Set(records.map(r => r.trackKey).filter((k): k is string => !!k));

  // Plays and boosts are charted apart. Measured over a real node, one combined
  // score let podcasts and test feeds take the whole top of the chart.
  const plays = collapseToPlays(records);
  const deliberate = records.filter(isBoostRecord);

  return {
    boosts: records.length,
    plays: plays.length,
    streamRecords: records.filter(r => r.actionName === 'stream').length,
    ...(withCharts
      ? { topPlays: topTracks(plays, 10), topBoosts: topTracks(deliberate, 10) }
      : {}),
    keyed: records.filter(r => KEYED_SOURCES.has(r.trackSource)).length,
    named: records.filter(r => !!r.trackTitle).length,
    withMessageTitle: records.filter(r => r.hasMessageTitle).length,
    distinctTracks: distinctTracks.size,
    satsTotal: Math.round(records.reduce((sum, r) => sum + r.valueMsatTotal, 0) / 1000),
    satsReceived: Math.round(records.reduce((sum, r) => sum + r.valueMsat, 0) / 1000),
    bySource,
    byAction: tally(records.map(r => r.actionName)),
    byApp: Object.entries(tally(records.map(r => r.app || 'unknown')))
      .map(([app, boosts]) => ({ app, boosts }))
      .sort((a, b) => b.boosts - a.boosts),
    byWeek: [...byWeek.values()]
      .map(b => ({ week: b.week, boosts: b.boosts, tracks: b.tracks.size, satsTotal: b.satsTotal }))
      .sort((a, b) => a.week.localeCompare(b.week))
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = req.headers['x-admin-key'];
  const hasLegacyAdmin = !!process.env.MSP_ADMIN_KEY && typeof adminKey === 'string' &&
    timingSafeEqualString(adminKey, process.env.MSP_ADMIN_KEY);
  const nostrAdmin = await parseAuthHeader(req.headers['authorization'] as string | undefined);

  if (!hasLegacyAdmin && !nostrAdmin.valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await readAllDerived();
    // The chart would only ever be built from MSP's own splits; everything else on the
    // node is Chad's other income and says nothing about feeds made with MSP.
    const mspOnly = all.filter(r => r.isMspSplit);

    return res.status(200).json({
      generatedAt: Date.now(),
      totals: { all: all.length, mspSplit: mspOnly.length, other: all.length - mspOnly.length },
      // Charts are MSP splits only. "everything" is a diagnostic on what else is on
      // the node, and deliberately carries no chart at all.
      msp: summarize(mspOnly, true),
      everything: summarize(all, false)
    });
  } catch (error) {
    console.error('Boost coverage failed:', error);
    return res.status(500).json({ error: 'Failed to read boost data' });
  }
}
