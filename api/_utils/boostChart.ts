/**
 * Turning stored boost records into chart rows.
 *
 * The signals are kept apart on purpose. A **play** comes from streaming sats, which
 * are emitted during music playback and carry a remoteItem reference, so they are
 * naturally a music-only signal. A **boost** is a deliberate act and a much stronger
 * endorsement, but it happens on podcasts and test feeds too. Measured over a real
 * node, mixing them into one score let test feeds and podcasts take the whole top of
 * the chart while the music sat below it — so they are charted separately.
 */
import type { DerivedBoost } from './boostRecord.js';

/**
 * How long a gap ends a listening run. Streaming sats fire about once a minute, so a
 * single play of one track is several records; counting them raw would rank tracks by
 * length rather than popularity. Twenty minutes is well past any inter-record gap
 * within a song and well short of a listener returning to a track later.
 */
export const DEFAULT_PLAY_GAP_MS = 20 * 60 * 1000;

export interface ChartRow {
  trackKey: string;
  trackTitle?: string;
  trackArtist?: string;
  count: number;
}

/**
 * Streaming sats only. Auto-boosts are excluded deliberately — they are counted with
 * boosts, not here, so the two lists never double-count the same record.
 */
export function isPlayRecord(record: DerivedBoost): boolean {
  return record.actionName === 'stream';
}

/**
 * Boosts and auto-boosts together, deliberately.
 *
 * An auto-boost fires because an app played the track, so it is arguably a listening
 * signal rather than an endorsement — and it dominates: measured on real data, 126 of
 * the 151 named records here are automatic. Splitting them out was considered and
 * rejected; manual boosts alone come to 21 tracks with a top count of 2, which is too
 * thin to chart. The wording on the page says both are included, and that is the part
 * that has to stay true if this is ever revisited.
 */
export function isBoostRecord(record: DerivedBoost): boolean {
  return record.actionName === 'boost' || record.actionName === 'auto';
}

/**
 * Collapse each listener's consecutive streams of one track into a single play.
 *
 * Grouping is by listener, app and track. When no `listenerKey` is available — the
 * hash key is unset, or the app named no sender — the run collapses on app and track
 * alone. That undercounts two people playing the same track at the same moment, which
 * is the right way to be wrong: it can only ever lower a count, never inflate one.
 */
export function collapseToPlays(
  records: DerivedBoost[],
  gapMs: number = DEFAULT_PLAY_GAP_MS
): DerivedBoost[] {
  const streams = records
    .filter(r => isPlayRecord(r) && r.trackKey)
    .sort((a, b) => a.ts - b.ts || a.index - b.index);

  const plays: DerivedBoost[] = [];
  const lastSeen = new Map<string, number>();

  for (const record of streams) {
    const key = `${record.listenerKey ?? 'anon'}|${record.app}|${record.trackKey}`;
    const previous = lastSeen.get(key);
    // Seconds on the wire, milliseconds in the gap — convert before comparing.
    if (previous === undefined || (record.ts - previous) * 1000 > gapMs) plays.push(record);
    lastSeen.set(key, record.ts);
  }

  return plays;
}

/**
 * Rank by count, then by title so equal counts don't reorder between requests.
 * Omit `limit` to get every track rather than a top slice.
 */
export function topTracks(records: DerivedBoost[], limit?: number): ChartRow[] {
  const rows = new Map<string, ChartRow>();

  for (const record of records) {
    if (!record.trackKey) continue;
    const existing = rows.get(record.trackKey);
    if (existing) {
      existing.count += 1;
      existing.trackTitle ??= record.trackTitle;
      existing.trackArtist ??= record.trackArtist;
    } else {
      rows.set(record.trackKey, {
        trackKey: record.trackKey,
        trackTitle: record.trackTitle,
        trackArtist: record.trackArtist,
        count: 1
      });
    }
  }

  const ranked = [...rows.values()]
    .sort((a, b) => b.count - a.count || (a.trackTitle ?? '').localeCompare(b.trackTitle ?? ''));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}
