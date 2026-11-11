/**
 * Feed corpus round trip — what MSP keeps, changes and drops when it imports a real
 * published feed and saves it again.
 *
 * Every other parser/generator test here builds its input from MSP's own idea of a
 * feed, so it can only catch MSP disagreeing with itself. The feeds in
 * src/test/feed-corpus/ were written by other tools — Wavlake, Fountain, Podhome,
 * WordPress plugins, hand-made files, and MSP itself — and each one goes through the
 * same import and save the app runs (importLikeApp / saveLikeApp below).
 *
 * Two checks per feed:
 *
 * 1. A second save changes nothing. Import → save → import → save must give the
 *    bytes of the first save. A difference means each save drifts the feed a little
 *    further, which nobody would notice until it mattered.
 *
 * 2. The round-trip report is pinned as a snapshot: each element or attribute whose
 *    count drops (`lost`) or grows (`added`), and each one whose count is unchanged
 *    but whose values differ (`changed`). MSP regenerates a feed from its model
 *    instead of editing the source in place, so some loss is expected. The snapshot
 *    makes it visible, and makes any NEW loss fail. When the snapshot changes, read
 *    the diff: a removed line is MSP keeping something it used to drop; a new line is
 *    a regression unless the PR says why.
 *
 *        npx vitest run src/utils/feedCorpus.roundTrip.test.ts -u   # accept a change
 *
 * The corpus is written only by tools/fetch-feed-corpus.mjs, and the integrity test
 * below compares each file with the sha256 that script recorded. If a feed breaks
 * MSP, fix MSP — never trim the feed to make the test pass.
 *
 * Files are loaded with import.meta.glob `?raw`, not node:fs: tsconfig.app.json types
 * only `vite/client`, and the Desktop App fork runs src/ tests under jsdom, where
 * import.meta.url is not a file: URL. `?raw` works the same in both.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { isPublisherFeed, isVideoFeed, parsePublisherRssFeed, parseRssFeed } from './xmlParser';
import { generatePublisherRssFeed, generateRssFeed } from './xmlGenerator';
import type { Album, PublisherFeed } from '../types/feed';
import manifestText from '../test/feed-corpus/manifest.json?raw';
import exampleFeedXml from '../../example-feed.xml?raw';

interface ManifestEntry {
  file: string;
  kind: string;
  url: string;
  final_url?: string;
  fetched_at?: string;
  bytes?: number;
  sha256?: string;
}

const manifest = JSON.parse(manifestText) as { feeds: ManifestEntry[] };

const corpusFiles = import.meta.glob('../test/feed-corpus/*.xml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const byName = new Map(
  Object.entries(corpusFiles).map(([path, xml]) => [path.slice(path.lastIndexOf('/') + 1), xml]),
);

// fetch().text() and FileReader.readAsText() both drop a UTF-8 BOM, so the parser
// never sees one in the app. Two corpus feeds start with one.
const withoutBom = (xml: string): string => (xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml);

/** Each feed the round trip runs: the corpus, then MSP's own example feed. */
const FEEDS: Array<{ name: string; xml: string }> = [
  ...manifest.feeds
    .filter((entry) => byName.has(entry.file))
    .map((entry) => ({ name: entry.file, xml: withoutBom(byName.get(entry.file)!) })),
  { name: 'example-feed.xml (repo root)', xml: exampleFeedXml },
];

// ---------------------------------------------------------------------------
// The app's import and save, without the UI.
// ---------------------------------------------------------------------------

type Imported =
  | { as: 'publisher'; feed: PublisherFeed }
  | { as: 'video' | 'album'; feed: Album };

/**
 * App.tsx handleImport: publisher, then video, then album. A non-music album makes
 * the app ask with confirm(); this takes the "continue" answer, which sets the
 * medium to music. backfillEnclosureSizes is left out — it is a network fill of
 * `<enclosure length>`, and an empty length is already reported by the feed check.
 */
function importLikeApp(xml: string): Imported {
  if (isPublisherFeed(xml)) return { as: 'publisher', feed: parsePublisherRssFeed(xml) };
  if (isVideoFeed(xml)) return { as: 'video', feed: parseRssFeed(xml) };
  const album = parseRssFeed(xml);
  if (album.medium !== 'music') album.medium = 'music';
  return { as: 'album', feed: album };
}

/** SaveModal generateCurrentFeedXml: every save stamps lastBuildDate with now. */
function saveLikeApp(imported: Imported): string {
  const now = new Date().toUTCString();
  return imported.as === 'publisher'
    ? generatePublisherRssFeed({ ...imported.feed, lastBuildDate: now })
    : generateRssFeed({ ...imported.feed, lastBuildDate: now });
}

// ---------------------------------------------------------------------------
// The inventory: how many of each element and attribute, and their values.
// ---------------------------------------------------------------------------

// A separate parser from the app's on purpose: the report must not share a blind
// spot with the code it measures. preserveOrder keeps repeated siblings and
// processing instructions such as <?xml-stylesheet?>; comments are not counted.
const inventoryParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

interface Inventory {
  /** Occurrences of each element path (`a/b/c`) and attribute path (`a/b/c@x`). */
  counts: Map<string, number>;
  /** Text of each element path and value of each attribute path, in document order. */
  values: Map<string, string[]>;
}

type OrderedNode = Record<string, unknown>;

function inventory(xml: string): Inventory {
  const counts = new Map<string, number>();
  const values = new Map<string, string[]>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const record = (key: string, value: string) => {
    const list = values.get(key);
    if (list) list.push(value);
    else values.set(key, [value]);
  };

  const walk = (nodes: OrderedNode[], parent: string): void => {
    for (const node of nodes) {
      for (const [name, children] of Object.entries(node)) {
        if (name === ':@' || name === '?xml') continue;
        if (name === '#text') {
          if (parent) record(parent, String(children));
          continue;
        }
        const path = parent ? `${parent}/${name}` : name;
        bump(path);
        const attrs = node[':@'] as Record<string, unknown> | undefined;
        for (const [attr, value] of Object.entries(attrs ?? {})) {
          bump(`${path}@${attr}`);
          record(`${path}@${attr}`, String(value));
        }
        if (Array.isArray(children)) walk(children as OrderedNode[], path);
      }
    }
  };

  walk(inventoryParser.parse(xml) as OrderedNode[], '');
  return { counts, values };
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

/**
 * Values every save replaces by design, so a difference there says nothing about the
 * feed: SaveModal stamps lastBuildDate, and the generator always writes its own
 * <generator>. Left in, they would add the same line to every report.
 */
const REPLACED_ON_EVERY_SAVE = new Set(['rss/channel/lastBuildDate', 'rss/channel/generator']);

const EXAMPLE_CHARS = 60;
const quote = (value: string | undefined): string => {
  if (value === undefined) return '—';
  const flat = value.replace(/\s+/g, ' ');
  return JSON.stringify(flat.length > EXAMPLE_CHARS ? `${flat.slice(0, EXAMPLE_CHARS)}…` : flat);
};

/** Multiset difference, in the document order of `from`. */
function missingFrom(from: string[], other: string[]): string[] {
  const left = new Map<string, number>();
  for (const value of other) left.set(value, (left.get(value) ?? 0) + 1);
  const out: string[] = [];
  for (const value of from) {
    const n = left.get(value) ?? 0;
    if (n > 0) left.set(value, n - 1);
    else out.push(value);
  }
  return out;
}

interface RoundTripReport {
  importedAs: Imported['as'];
  sourceMedium: string;
  /** `path: source → saved`, for each path whose count went down. */
  lost: string[];
  /** `path: source → saved`, for each path whose count went up. */
  added: string[];
  /** Same count, different values: `path (n of m): "was" → "now"` (first example). */
  changed: string[];
}

function report(source: string, saved: string, importedAs: Imported['as']): RoundTripReport {
  const before = inventory(source);
  const after = inventory(saved);
  const lost: string[] = [];
  const added: string[] = [];
  const changed: string[] = [];

  const paths = [...new Set([...before.counts.keys(), ...after.counts.keys()])].sort();
  for (const path of paths) {
    const was = before.counts.get(path) ?? 0;
    const now = after.counts.get(path) ?? 0;
    if (now < was) lost.push(`${path}: ${was} → ${now}`);
    else if (now > was) added.push(`${path}: ${was} → ${now}`);
  }

  const valuePaths = [...new Set([...before.values.keys(), ...after.values.keys()])].sort();
  for (const path of valuePaths) {
    if (REPLACED_ON_EVERY_SAVE.has(path)) continue;
    const was = before.values.get(path) ?? [];
    const now = after.values.get(path) ?? [];
    // A count change is already a lost/added line; only report values that were
    // rewritten in place.
    if (was.length === 0 || was.length !== now.length) continue;
    const gone = missingFrom(was, now);
    if (gone.length === 0) continue;
    const fresh = missingFrom(now, was);
    changed.push(`${path} (${gone.length} of ${was.length}): ${quote(gone[0])} → ${quote(fresh[0])}`);
  }

  return {
    importedAs,
    sourceMedium: before.values.get('rss/channel/podcast:medium')?.[0] ?? '(none)',
    lost,
    added,
    changed,
  };
}

/** The first line on which two saves differ, for a readable failure. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const left = a.split('\n');
  const right = b.split('\n');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return `line ${i + 1}:\n  first save:  ${left[i] ?? '(end)'}\n  second save: ${right[i] ?? '(end)'}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Determinism: the parser fills a missing pubDate with now and a missing guid or
// id with crypto.randomUUID(). Both are pinned so a snapshot cannot flap.
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-11-10T12:00:00Z');
let uuidCounter = 0;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}` as ReturnType<Crypto['randomUUID']>;
  });
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  uuidCounter = 0;
});

// ---------------------------------------------------------------------------

describe('feed corpus', () => {
  it('lists every corpus file in the manifest, and has a file for every entry', () => {
    const listed = manifest.feeds.map((entry) => entry.file).sort();
    expect([...byName.keys()].sort()).toEqual(listed);
  });

  it('holds the bytes that tools/fetch-feed-corpus.mjs recorded', async () => {
    const mismatched: string[] = [];
    for (const entry of manifest.feeds) {
      const bytes = new TextEncoder().encode(byName.get(entry.file) ?? '');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (hex !== entry.sha256 || bytes.length !== entry.bytes) mismatched.push(entry.file);
    }
    expect(mismatched).toEqual([]);
  });
});

// A plain loop, not describe.each: `$name` is cut to 40 characters, and the test name
// is the snapshot key, so two long file names with one prefix would share a snapshot.
for (const { name, xml } of FEEDS) {
  describe(`round trip: ${name}`, () => {
    it('a second save gives the bytes of the first', () => {
      const first = saveLikeApp(importLikeApp(xml));
      const second = saveLikeApp(importLikeApp(first));
      expect(firstDifference(first, second)).toBeNull();
    });

    it('keeps, changes and drops what the snapshot records', () => {
      const imported = importLikeApp(xml);
      expect(report(xml, saveLikeApp(imported), imported.as)).toMatchSnapshot();
    });
  });
}
