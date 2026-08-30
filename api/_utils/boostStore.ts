/**
 * Blob-backed storage for boost records.
 *
 *   boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index>.json
 *       The verbatim payload, listener message and sender name included. Written once,
 *       never rewritten, never served by any endpoint.
 *   boosts/derived/<isoYear>-W<week>.json
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
import type { DerivedBoost, ParsedBoost } from './boostRecord.js';
import { isoWeekKey, monthKey, toDerived } from './boostRecord.js';

export const DERIVED_PREFIX = 'boosts/derived/';

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
  const blobs = await listAll(DERIVED_PREFIX);
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
 * Write one week's derived file from the complete set of that week's records.
 *
 * The caller must supply every record for the week, because this replaces the file
 * outright. That requirement is the point: with no previous version to merge, there is
 * no read, and therefore nothing a 60-second CDN cache can corrupt.
 */
export async function replaceDerivedWeek(
  weekKey: string,
  records: ParsedBoost[]
): Promise<number> {
  const byIndex = new Map<number, DerivedBoost>();
  for (const record of records) {
    if (isoWeekKey(record.ts) !== weekKey) continue;
    byIndex.set(record.index, toDerived(record));
  }
  const week = [...byIndex.values()].sort((a, b) => a.ts - b.ts || a.index - b.index);
  await putJson(derivedPath(weekKey), week, true);
  return week.length;
}
