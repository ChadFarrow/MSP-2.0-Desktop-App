/**
 * Blob-backed storage for boost records.
 *
 * Two namespaces, both public Vercel Blobs (the SDK has no private mode), following
 * the same "unguessable path" arrangement accountStore.ts documents:
 *
 *   boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index>.json
 *       The verbatim webhook payload, listener message and sender name included.
 *       Never served by any endpoint.
 *   boosts/derived/<isoYear>-W<week>.json
 *       The PII-free projection. This is what the coverage report reads and what a
 *       public chart would read later.
 *
 * The namespace segment is load-bearing. Helipad's `index` is a small incrementing
 * integer, so boosts/raw/2026-08/10695.json would be trivially enumerable if the blob
 * store subdomain ever leaked. One high-entropy segment puts the whole raw tree behind
 * the same guarantee the accounts/ tree already relies on.
 *
 * Deduplication is the raw path itself: `index` is unique per node, and the write uses
 * allowOverwrite: false. The derived merge, by contrast, runs for every record in a
 * batch whether or not its raw blob already existed — that is what makes re-running
 * tools/import-helipad.mjs repair a lost derived write, and what lets an improved
 * resolveTrack() be applied to history without changing anything here.
 */
import { put, list } from '@vercel/blob';
import type { DerivedBoost, ParsedBoost } from './boostRecord.js';
import { isoWeekKey, monthKey, toDerived } from './boostRecord.js';

export const DERIVED_PREFIX = 'boosts/derived/';

/** Rejects a misconfigured namespace rather than letting it build a path we didn't mean. */
const NAMESPACE_RE = /^[A-Za-z0-9_-]{16,128}$/;

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
  return `${rawMonthPrefix(monthKey(boost.ts))}${boost.direction}-${boost.index}.json`;
}

export function derivedPath(weekKey: string): string {
  return `${DERIVED_PREFIX}${weekKey}.json`;
}

export interface RawStoredBoost {
  receivedAt: number;
  source: 'webhook' | 'import';
  payload: unknown;
}

export interface StoreResult {
  written: number;
  duplicates: number;
  weeks: string[];
  /** Records stored in each touched week after the merge. Observability, not bookkeeping. */
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

/**
 * Read a blob, bypassing the CDN.
 *
 * A blob written with addRandomSuffix:false keeps a stable public URL, and Vercel's
 * CDN caches that URL. The derived week file is read-modify-write, so a cached read
 * merges new records onto a stale base and *shrinks* the stored file — silently, and
 * worse the more often a week is touched. no-store on the read and a zero max-age on
 * the write are both needed: the first fixes this process, the second stops an already
 * cached copy being served to the next one.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
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
    allowOverwrite,
    // Raw records are immutable, but the derived week files are rewritten on every
    // merge. Caching a mutable blob under a stable URL is what makes a read-modify-write
    // lose data, so nothing here is cached.
    cacheControlMaxAge: 0
  });
}

/** Read one week's derived records, or an empty list when the week has none yet. */
export async function readDerivedWeek(weekKey: string): Promise<DerivedBoost[]> {
  const path = derivedPath(weekKey);
  const blobs = await listAll(path);
  const blob = blobs.find(b => b.pathname === path);
  if (!blob) return [];
  return (await fetchJson<DerivedBoost[]>(blob.url)) ?? [];
}

/** Read every derived week, newest week last. */
export async function readAllDerived(): Promise<DerivedBoost[]> {
  const blobs = await listAll(DERIVED_PREFIX);
  blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  const weeks = await Promise.all(blobs.map(b => fetchJson<DerivedBoost[]>(b.url)));
  return weeks.flatMap(week => week ?? []);
}

async function mergeDerivedWeek(weekKey: string, incoming: DerivedBoost[]): Promise<number> {
  const existing = await readDerivedWeek(weekKey);
  const byIndex = new Map<number, DerivedBoost>();
  for (const record of existing) byIndex.set(record.index, record);
  // Incoming wins: a re-import re-derives history with the current resolveTrack().
  for (const record of incoming) byIndex.set(record.index, record);

  const merged = [...byIndex.values()].sort((a, b) => a.ts - b.ts || a.index - b.index);
  await putJson(derivedPath(weekKey), merged, true);
  return merged.length;
}

/**
 * Store a batch: write the raw blobs that are new, then merge the derived projection
 * for the whole batch. Returns how many were new, so the import script can report
 * progress and a caller can tell a replayed webhook from a fresh one.
 */
export async function storeBoosts(
  entries: { parsed: ParsedBoost; payload: unknown }[],
  source: RawStoredBoost['source']
): Promise<StoreResult> {
  if (entries.length === 0) return { written: 0, duplicates: 0, weeks: [], weekSizes: {} };

  // One listing per month beats one existence check per record on a 200-record import.
  const months = [...new Set(entries.map(e => monthKey(e.parsed.ts)))];
  const existingPaths = new Set<string>();
  for (const month of months) {
    for (const blob of await listAll(rawMonthPrefix(month))) existingPaths.add(blob.pathname);
  }

  const receivedAt = Date.now();
  let written = 0;
  let duplicates = 0;

  for (const entry of entries) {
    const path = rawPath(entry.parsed);
    if (existingPaths.has(path)) {
      duplicates += 1;
      continue;
    }
    try {
      await putJson(path, { receivedAt, source, payload: entry.payload } satisfies RawStoredBoost, false);
      written += 1;
    } catch (error) {
      // A blob that appeared between the listing and this write is still a duplicate,
      // not a failure. allowOverwrite:false is what turns that race into a clean signal.
      if (!isAlreadyExists(error)) throw error;
      duplicates += 1;
    }
  }

  const byWeek = new Map<string, DerivedBoost[]>();
  for (const entry of entries) {
    const week = isoWeekKey(entry.parsed.ts);
    const bucket = byWeek.get(week);
    if (bucket) bucket.push(toDerived(entry.parsed));
    else byWeek.set(week, [toDerived(entry.parsed)]);
  }
  // Report the stored size of every week touched. A caller can compare it against what
  // it sent, which is the check that would have caught the caching bug immediately.
  const weekSizes: Record<string, number> = {};
  for (const [week, records] of byWeek) weekSizes[week] = await mergeDerivedWeek(week, records);

  return { written, duplicates, weeks: [...byWeek.keys()], weekSizes };
}
