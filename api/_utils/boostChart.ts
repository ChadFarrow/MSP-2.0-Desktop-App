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
import { monthKey, recordKey } from './boostRecord.js';

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
  /**
   * Other artist spellings `mergeAliases` folded into this row, in the order it met them.
   * Absent when nothing with a different spelling was merged — the chart marks these rows
   * so a wrong merge can be seen.
   */
  mergedFrom?: string[];
  /**
   * The distinct `listenerKey`s behind this row. Internal: the API publishes only the
   * count, because a key is a stable pseudonym and a set of them is a list of listeners.
   */
  listenerKeys: Set<string>;
  /** Records that named no sender, so they add to the count but to no listener. */
  unattributed: number;
  /** Every chart key folded into this row — how a month's row finds its all-time song. */
  chartKeys: Set<string>;
  /** When the row's earliest record was paid, unix seconds. */
  firstTs: number;
  /** Records per UTC month (`monthKey`) — the row's trend. */
  byMonth: Map<string, number>;
}

function addMonths(into: Map<string, number>, from: Map<string, number>): void {
  from.forEach((n, month) => into.set(month, (into.get(month) ?? 0) + n));
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
    .sort((a, b) => a.ts - b.ts || recordKey(a).localeCompare(recordKey(b)));

  const plays: DerivedBoost[] = [];
  const lastSeen = new Map<string, number>();

  for (const record of streams) {
    const key = `${record.listenerKey ?? 'anon'}|${record.app}|${chartKey(record)}`;
    const previous = lastSeen.get(key);
    // Seconds on the wire, milliseconds in the gap — convert before comparing.
    if (previous === undefined || (record.ts - previous) * 1000 > gapMs) plays.push(record);
    lastSeen.set(key, record.ts);
  }

  return plays;
}

/** Lowercase, unaccented, punctuation-free — for comparing two spellings of one name. */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * What one chart row counts. A boost link is an app's own URL and ought to name one song,
 * but v4vmusic's does not: measured on 2026-09-27, 28 of 75 boost links carried more than
 * one song title (144 boosts), one of them six songs. Keyed on the link alone, the chart
 * summed different songs under whichever title came first — "Copenhagen Time" showed 19
 * where 14 were its own. So a boost-link record is keyed by its link and title together,
 * and an untitled one stays apart rather than joining some song on the same link. A guid
 * or title key does name one song, so it keeps its key, and a record without a title still
 * takes one from another record of the same key.
 */
function chartKey(record: DerivedBoost): string | undefined {
  if (!record.trackKey) return undefined;
  if (record.trackSource === 'boost-link' && record.trackTitle) {
    return `${record.trackKey}|${normalize(record.trackTitle)}`;
  }
  return record.trackKey;
}

/** The part after the last " - ", normalized: the artist in "Album - Artist". */
function lastPart(value: string | undefined): string {
  return normalize((value ?? '').split(' - ').pop() ?? '');
}

/**
 * Merge rows that are the same track wearing two different names.
 *
 * A track's key comes from whichever rung of the resolution ladder answered, so one boost
 * resolving by remote guid and another by boost link produce different keys for the same
 * song — and the chart then splits its count across two rows. Observed live: "When You're
 * Smiling (2026 remix)" sat at rank 1 with 4 boosts and rank 10 with 1, because Helipad
 * gave the feed as `Technopolymère - Bacalao` for some records and `Technopolymère` for
 * others.
 *
 * The rule is deliberately narrow: same normalized title, and one artist string either a
 * prefix of the other or equal to the other's last " - " part. That catches "Album" and
 * "Artist" versus "Album - Artist", which are the shapes the data actually takes — the
 * message scrape gives "Album - Artist", Podcast Index's feed title gives the album, and
 * some apps give the artist. Observed live: "Copenhagen Time" charted three times under
 * "Kulture Collection - Matt Finlay", "Kulture Collection" and "Matt Finlay". A bare
 * suffix match is not used, or "Fred" would join "Right Said Fred". Chad's rule, 2026-09-27:
 * the same title and the same artist are the same song, whatever the release. "Album" and
 * "Artist" alone cannot be joined — nothing in the data says they belong together.
 *
 * The longest artist wins as the label, since it is the most informative, and every other
 * spelling it absorbed is kept in `mergedFrom` so the chart can show the merge.
 */
function mergeAliases(rows: ChartRow[]): ChartRow[] {
  const byTitle = new Map<string, ChartRow[]>();
  const untitled: ChartRow[] = [];

  for (const row of rows) {
    if (!row.trackTitle) { untitled.push(row); continue; }
    const key = normalize(row.trackTitle);
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(row);
    else byTitle.set(key, [row]);
  }

  const merged: ChartRow[] = [];
  for (const bucket of byTitle.values()) {
    // Longest artist first, so a shorter spelling folds into the fuller one.
    const ordered = [...bucket].sort(
      (a, b) => (b.trackArtist ?? '').length - (a.trackArtist ?? '').length
    );
    const groups: ChartRow[] = [];
    for (const row of ordered) {
      const artist = normalize(row.trackArtist ?? '');
      const into = groups.find(g => {
        const other = normalize(g.trackArtist ?? '');
        return artist === other || other.startsWith(artist) || artist.startsWith(other)
          || lastPart(g.trackArtist) === artist || lastPart(row.trackArtist) === other;
      });
      if (!into) {
        groups.push({
          ...row,
          listenerKeys: new Set(row.listenerKeys),
          chartKeys: new Set(row.chartKeys),
          byMonth: new Map(row.byMonth)
        });
        continue;
      }
      into.count += row.count;
      into.unattributed += row.unattributed;
      into.firstTs = Math.min(into.firstTs, row.firstTs);
      row.listenerKeys.forEach(k => into.listenerKeys.add(k));
      row.chartKeys.forEach(k => into.chartKeys.add(k));
      addMonths(into.byMonth, row.byMonth);
      // Record only a spelling that differs: an identical one is certain, not worth review.
      const known = [into.trackArtist, ...(into.mergedFrom ?? [])].map(a => normalize(a ?? ''));
      if (row.trackArtist && !known.includes(artist)) {
        into.mergedFrom = [...(into.mergedFrom ?? []), row.trackArtist];
      }
    }
    merged.push(...groups);
  }

  return [...merged, ...untitled];
}

/**
 * Rank by count, then by title so equal counts don't reorder between requests.
 * Omit `limit` to get every track rather than a top slice.
 */
export function topTracks(records: DerivedBoost[], limit?: number): ChartRow[] {
  const rows = new Map<string, ChartRow>();

  for (const record of records) {
    const key = chartKey(record);
    if (!key) continue;
    let row = rows.get(key);
    if (!row) {
      row = {
        trackKey: key,
        trackTitle: record.trackTitle,
        trackArtist: record.trackArtist,
        count: 0,
        listenerKeys: new Set(),
        unattributed: 0,
        chartKeys: new Set([key]),
        firstTs: record.ts,
        byMonth: new Map()
      };
      rows.set(key, row);
    }
    row.count += 1;
    row.trackTitle ??= record.trackTitle;
    row.trackArtist ??= record.trackArtist;
    row.firstTs = Math.min(row.firstTs, record.ts);
    const month = monthKey(record.ts);
    row.byMonth.set(month, (row.byMonth.get(month) ?? 0) + 1);
    if (record.listenerKey) row.listenerKeys.add(record.listenerKey);
    else row.unattributed += 1;
  }

  const ranked = mergeAliases([...rows.values()])
    .sort((a, b) => b.count - a.count || (a.trackTitle ?? '').localeCompare(b.trackTitle ?? ''));
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

export interface ArtistRow {
  /** Normalized name — what two spellings of one artist share. */
  artistKey: string;
  artist: string;
  count: number;
  /** Song rows behind this artist. */
  songs: number;
  listenerKeys: Set<string>;
  unattributed: number;
  /** Album-only labels given to this artist through `albumArtists`; absent when none. */
  mergedFrom?: string[];
  firstTs: number;
  /** Its songs' counts per month, added up. */
  byMonth: Map<string, number>;
}

/** "Album - Artist" split at its last " - "; undefined for a label that names one thing. */
function splitLabel(label: string): { album: string; artist: string } | undefined {
  const at = label.lastIndexOf(' - ');
  if (at < 0) return undefined;
  const album = label.slice(0, at).trim();
  const artist = label.slice(at + 3).trim();
  return album && artist ? { album, artist } : undefined;
}

/**
 * Album → artist, learned from every label that names both, keyed by normalized album.
 *
 * Podcast Index gives a remote item's feed title, which for music is the album, so some
 * rows say only "Kulture Collection" where the message scrape says "Kulture Collection -
 * Matt Finlay". A row naming both is what links them — the same rule `mergeAliases`
 * follows. An album named with two different artists maps to neither: "Singles" is a
 * feed title many artists use, and an album-only "Singles" could be any of them.
 */
export function albumArtists(rows: ChartRow[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const row of rows) {
    for (const label of [row.trackArtist, ...(row.mergedFrom ?? [])]) {
      const parts = label ? splitLabel(label) : undefined;
      if (!parts) continue;
      const album = normalize(parts.album);
      const prior = seen.get(album);
      if (prior === undefined) seen.set(album, parts.artist);
      else if (prior !== null && normalize(prior) !== normalize(parts.artist)) seen.set(album, null);
    }
  }
  return new Map([...seen].filter((entry): entry is [string, string] => entry[1] !== null));
}

/**
 * Song rows grouped by artist, ranked by count and then name. The artist is the part after
 * the last " - " of a row's label, or the whole label when it names one thing — unless
 * `albums` says that one thing is an album, in which case the row goes to its artist and
 * the artist row lists the label in `mergedFrom`, so the inference can be checked.
 *
 * Pass the all-time `albums` for a month, so a month groups its artists exactly as all
 * time does. Rows with no title or no artist are left out: an artist row nobody can read,
 * or one made of unreadable songs, is not a chart entry.
 */
export function topArtists(rows: ChartRow[], albums: Map<string, string> = albumArtists(rows)): ArtistRow[] {
  const byArtist = new Map<string, ArtistRow>();

  for (const row of rows) {
    if (!row.trackTitle || !row.trackArtist) continue;
    const label = row.trackArtist.trim();
    const split = splitLabel(label);
    const inferred = split ? undefined : albums.get(normalize(label));
    const name = split?.artist ?? inferred ?? label;
    const key = normalize(name);
    if (!key) continue;

    let artist = byArtist.get(key);
    if (!artist) {
      // Rows arrive ranked, so the label comes from the artist's most counted song.
      artist = {
        artistKey: key, artist: name, count: 0, songs: 0,
        listenerKeys: new Set(), unattributed: 0, firstTs: row.firstTs, byMonth: new Map()
      };
      byArtist.set(key, artist);
    }
    artist.count += row.count;
    artist.songs += 1;
    artist.unattributed += row.unattributed;
    artist.firstTs = Math.min(artist.firstTs, row.firstTs);
    row.listenerKeys.forEach(k => artist.listenerKeys.add(k));
    addMonths(artist.byMonth, row.byMonth);
    if (inferred && normalize(inferred) !== normalize(label) && !artist.mergedFrom?.includes(label)) {
      artist.mergedFrom = [...(artist.mergedFrom ?? []), label];
    }
  }

  return [...byArtist.values()].sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist));
}

/**
 * What all time knows about each song and artist, so a month can say which of its rows
 * are new and group its artists the same way all time does.
 *
 * Built once from every counted record. A month on its own is not enough: its row for a
 * song may hold only the spelling that first appeared that month, while all time has
 * merged it with a spelling supported months earlier — and a month that only has an
 * album-only label cannot know the artist a July row named for that album.
 */
export interface ChartIdentity {
  /** Chart key → when its all-time song was first supported, unix seconds. */
  songFirstTs: Map<string, number>;
  /** Album → artist, learned across all time (see `albumArtists`). */
  albums: Map<string, string>;
  /** Artist key → when the artist was first supported. */
  artistFirstTs: Map<string, number>;
  /** The month of the earliest counted record. Nothing is new in it: everything would be. */
  firstMonth?: string;
}

export function buildIdentity(records: DerivedBoost[]): ChartIdentity {
  const counted = records.filter(r => isBoostRecord(r) || isPlayRecord(r));
  const songs = topTracks(counted);
  const songFirstTs = new Map<string, number>();
  for (const row of songs) row.chartKeys.forEach(key => songFirstTs.set(key, row.firstTs));
  const albums = albumArtists(songs);
  const artistFirstTs = new Map(topArtists(songs, albums).map(a => [a.artistKey, a.firstTs] as const));
  const first = counted.reduce<number | undefined>((min, r) => (min === undefined || r.ts < min ? r.ts : min), undefined);
  return { songFirstTs, albums, artistFirstTs, firstMonth: first === undefined ? undefined : monthKey(first) };
}

/** A month row's song, dated by all time: the earliest of every spelling folded into it. */
export function songFirstSeen(row: ChartRow, identity: ChartIdentity): number {
  let first = row.firstTs;
  row.chartKeys.forEach(key => {
    const seen = identity.songFirstTs.get(key);
    if (seen !== undefined && seen < first) first = seen;
  });
  return first;
}

/** Whether something first supported at `firstTs` is new in `month`. */
export function isNewIn(month: string, firstTs: number, identity: ChartIdentity): boolean {
  return month !== identity.firstMonth && monthKey(firstTs) === month;
}
