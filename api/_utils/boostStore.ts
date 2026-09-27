/**
 * Blob-backed storage for boost records.
 *
 *   boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index | ph-<payment_hash>>.json
 *       The verbatim payload, listener message and sender name included. Written once,
 *       never rewritten, never served by any endpoint.
 *   boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json
 *       The PII-free projection a chart reads. Written whole, never merged.
 *
 * The namespace segment is load-bearing: Helipad's `index` is a small incrementing
 * integer, so the raw tree would be trivially enumerable if the blob store subdomain
 * ever leaked.
 *
 * **Nothing here reads a mutable blob before writing it, and that is the whole design.**
 * A Vercel Blob is served through a CDN that caches on pathname with a *minimum* 60s
 * TTL — `cacheControlMaxAge: 0` is clamped to 60, and a cache-busting query string does
 * not help because the CDN ignores the query when keying. Measured directly: a blob
 * written moments earlier came back with `x-vercel-cache: HIT` and `age: 58`. So a
 * read-modify-write cycle at import cadence *always* merges onto a stale base and
 * rewrites the file smaller. It cost 2,200 of 7,028 records before it was understood.
 *
 * Two properties make this design immune rather than merely careful:
 *   - Raw records are immutable, so a cached read of one is always correct.
 *   - A derived week is written from the complete set of that week's records, supplied
 *     by the caller. There is no previous version to merge with, so there is nothing a
 *     stale read could corrupt.
 */
import { put, list } from '@vercel/blob';
import type { BoostSource, DerivedBoost, ParsedBoost } from './boostRecord.js';
import { BOOSTBOX_CUTOVER, isoWeekKey, monthKey, parseBoostPayload, recordKey, toDerived } from './boostRecord.js';

/** Rejects a misconfigured namespace rather than letting it build a path we didn't mean. */
const NAMESPACE_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Blob writes run in parallel; one week can carry several hundred new records. */
const WRITE_CONCURRENCY = 16;

export function isBoostStoreConfigured(): boolean {
  const ns = process.env.MSP_BOOST_NAMESPACE;
  return typeof ns === 'string' && NAMESPACE_RE.test(ns);
}

function namespace(): string {
  const ns = process.env.MSP_BOOST_NAMESPACE;
  if (typeof ns !== 'string' || !NAMESPACE_RE.test(ns)) {
    throw new Error('MSP_BOOST_NAMESPACE is missing or malformed');
  }
  return ns;
}

export function rawMonthPrefix(month: string): string {
  return `boosts/raw/${namespace()}/${month}/`;
}

export function rawPath(boost: ParsedBoost): string {
  const id = boost.source === 'boostbox' ? `ph-${boost.paymentHash}` : String(boost.index);
  return `${rawMonthPrefix(monthKey(boost.ts))}${boost.direction}-${id}.json`;
}

/**
 * Weekly chart files, behind the same secret namespace as raw. They are public blobs at
 * fixed names and carry per-boost amounts the chart itself never shows, so a guessable
 * path would publish them. Until 2026-09-26 they lived at boosts/derived/<week>.json;
 * tools/migrate-derived-to-namespace.mjs moved them.
 */
export function derivedPrefix(): string {
  return `boosts/derived/${namespace()}/`;
}

export function derivedPath(weekKey: string): string {
  return `${derivedPrefix()}${weekKey}.json`;
}

export interface RawStoredBoost {
  receivedAt: number;
  source: 'webhook' | 'import' | 'boostbox';
  payload: unknown;
}

export interface StoreResult {
  written: number;
  duplicates: number;
  /** Records stored in each week whose derived file was rewritten. */
  weekSizes: Record<string, number>;
}

/** Page through every blob under a prefix. list() caps at 1000 per call. */
async function listAll(prefix: string): Promise<{ pathname: string; url: string }[]> {
  const found: { pathname: string; url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    found.push(...page.blobs.map(b => ({ pathname: b.pathname, url: b.url })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Blob read failed: ${response.status} ${url}`);
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

function isAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|blob_already_exists/i.test(message);
}

async function putJson(pathname: string, value: unknown, allowOverwrite: boolean): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite
  });
}

/** Run tasks with a bounded number in flight, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Read every derived week. Safe to serve from cache — a chart tolerates 60s of lag. */
export async function readAllDerived(): Promise<DerivedBoost[]> {
  const blobs = await listAll(derivedPrefix());
  blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const weeks = await mapLimit(blobs, WRITE_CONCURRENCY, b => fetchJson<DerivedBoost[]>(b.url));
  return weeks.flatMap(week => week ?? []);
}

/**
 * Write raw blobs for records that don't have one yet.
 *
 * Dedup is the path itself: `index` is unique per node and the write uses
 * allowOverwrite:false, so a replayed webhook is a no-op and a re-run of the importer
 * costs nothing. One listing per month beats an existence check per record.
 */
export async function storeRawBoosts(
  entries: { parsed: ParsedBoost; payload: unknown }[],
  source: RawStoredBoost['source']
): Promise<{ written: number; duplicates: number }> {
  if (entries.length === 0) return { written: 0, duplicates: 0 };

  const months = [...new Set(entries.map(e => monthKey(e.parsed.ts)))];
  const existingPaths = new Set<string>();
  for (const month of months) {
    for (const blob of await listAll(rawMonthPrefix(month))) existingPaths.add(blob.pathname);
  }

  const receivedAt = Date.now();
  let written = 0;
  let duplicates = 0;

  await mapLimit(entries, WRITE_CONCURRENCY, async (entry) => {
    const path = rawPath(entry.parsed);
    if (existingPaths.has(path)) {
      duplicates += 1;
      return;
    }
    try {
      await putJson(path, { receivedAt, source, payload: entry.payload } satisfies RawStoredBoost, false);
      written += 1;
    } catch (error) {
      // A blob that appeared between the listing and this write is still a duplicate.
      if (!isAlreadyExists(error)) throw error;
      duplicates += 1;
    }
  });

  return { written, duplicates };
}

/**
 * The UTC Monday and Sunday bounding an ISO week key.
 *
 * ISO week 1 is the week containing 4 January, so that date is the anchor: step back to
 * its Monday to get week 1, then forward in whole weeks. Deriving the bounds this way
 * rather than searching keeps it exact across the year boundaries where ISO and calendar
 * years disagree — 2026-W53 really does start in December 2026 and end in January 2027.
 */
export function weekBounds(weekKey: string): { start: Date; end: Date } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`Malformed ISO week key: ${weekKey}`);
  const year = Number(match[1]);
  const week = Number(match[2]);

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = Date.UTC(year, 0, 4 - (jan4Day - 1));

  const start = new Date(week1Monday + (week - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start, end };
}

/**
 * The calendar months a week's records can be filed under. Raw is bucketed by month, so
 * a week straddling a month boundary lives under two prefixes and both must be scanned.
 */
export function monthsForWeek(weekKey: string): string[] {
  const { start, end } = weekBounds(weekKey);
  const first = monthKey(Math.floor(start.getTime() / 1000));
  const last = monthKey(Math.floor(end.getTime() / 1000));
  return first === last ? [first] : [first, last];
}

/** Every stored raw record of one week whose path passes `keep`. Raw is immutable, so a cached read is correct. */
async function readRawWeek(weekKey: string, keep: (pathname: string) => boolean = () => true): Promise<ParsedBoost[]> {
  const blobs = (await Promise.all(
    monthsForWeek(weekKey).map(month => listAll(rawMonthPrefix(month)))
  )).flat().filter(b => keep(b.pathname));

  const stored = await mapLimit(blobs, WRITE_CONCURRENCY, b => fetchJson<RawStoredBoost>(b.url));
  const records: ParsedBoost[] = [];
  for (const record of stored) {
    const parsed = record ? parseBoostPayload(record.payload) : null;
    if (parsed && isoWeekKey(parsed.ts) === weekKey) records.push(parsed);
  }
  return records;
}

/**
 * msp-bot's raw records for one week. The Helipad importer supplies only Helipad's
 * records, and its whole-week write would otherwise replace the bot's with nothing.
 */
export async function readStoredBoostboxRecords(weekKey: string): Promise<ParsedBoost[]> {
  const records = await readRawWeek(weekKey, pathname => pathname.includes('/incoming-ph-'));
  return records.filter(r => r.source === 'boostbox');
}

/**
 * Rebuild one week's derived file from the raw records already stored.
 *
 * This is what lets a scheduled job keep the chart current without touching Helipad:
 * the webhook writes raw continuously, and raw is immutable, so reading it back — even
 * through a CDN — is always correct. The week file is then written whole, so there is no
 * read-modify-write and nothing a cache can corrupt.
 *
 * Returns null when the week has no raw records at all, so a caller can tell "nothing
 * there" from "genuinely empty" without writing an empty file over a real one.
 */
export async function rebuildWeekFromRaw(
  weekKey: string,
  extra: ParsedBoost[] = []
): Promise<number | null> {
  const records = await readRawWeek(weekKey);

  // `extra` is the caller's own just-written records. list() is not guaranteed to show a
  // blob written moments earlier, so a webhook that rebuilt purely from the listing could
  // drop the very boost that triggered it. replaceDerivedWeek dedupes on recordKey, so
  // folding them in is free when the listing did already include them.
  for (const record of extra) {
    if (isoWeekKey(record.ts) === weekKey) records.push(record);
  }

  if (records.length === 0) return null;
  return replaceDerivedWeek(weekKey, records);
}

/**
 * Keep one source per period: Helipad's records before BOOSTBOX_CUTOVER, the bot's from
 * it on. The bot holds every MSP split payment Helipad holds after the cutover, so
 * choosing by date counts each boost once without pairing records. Helipad records
 * after the cutover stay in raw; they are only left out here. A record with no source
 * predates the bot and is Helipad's.
 */
export function selectSource<T extends { source?: BoostSource; ts: number }>(records: T[]): T[] {
  return records.filter(r => (r.source === 'boostbox') === (r.ts >= BOOSTBOX_CUTOVER));
}

/**
 * Write one week's derived file from the complete set of that week's records.
 *
 * The caller must supply every record for the week, because this replaces the file
 * outright. That requirement is the point: with no previous version to merge, there is
 * no read, and therefore nothing a 60-second CDN cache can corrupt. Records are
 * de-duplicated on recordKey after selectSource picks one source per period.
 */
export async function replaceDerivedWeek(
  weekKey: string,
  records: ParsedBoost[]
): Promise<number> {
  const byKey = new Map<string, DerivedBoost>();
  for (const record of selectSource(records)) {
    if (isoWeekKey(record.ts) !== weekKey) continue;
    byKey.set(recordKey(record), toDerived(record));
  }
  const week = [...byKey.values()]
    .sort((a, b) => a.ts - b.ts || recordKey(a).localeCompare(recordKey(b)));
  await putJson(derivedPath(weekKey), week, true);
  return week.length;
}
