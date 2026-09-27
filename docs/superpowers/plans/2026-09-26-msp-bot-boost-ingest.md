# msp-bot Replaces the Helipad Webhook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `msp-bot` the chart's only live source — it forwards every MSP split payment (boosts and streams) to MSP's ingest — while MSP picks one source per record by a date cutover, fills song titles from Podcast Index, and keeps its weekly files private.

**Architecture:** Two repos. **Part A (MSP-2.0)** teaches `/api/boosts/ingest` a second record source keyed by payment hash, a cutover that keeps Helipad records before 2026-01-29T21:18:53Z and bot records from then on, a Podcast Index title lookup at ingest, and a namespaced derived path. **Part B (boostbox)** carries the payer's original metadata through the bot, adds a `boostbox.forward` namespace that builds Helipad-shaped records and queues failed sends, wires it into the poll loop, and adds a one-off backfill. **Part C** is the rollout.

**Tech Stack:** MSP-2.0 — TypeScript, Vercel functions, Vercel Blob, Vitest. boostbox — Clojure, babashka.http-client, jsonista, mulog, clojure.test via Kaocha.

**Spec:** `docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md` (MSP-2.0). Read it before starting; this plan argues from it.

## Global Constraints

- Cutover: `BOOSTBOX_CUTOVER = 1769721533` (2026-01-29T21:18:53Z). Helipad records with `ts < 1769721533` are kept; boostbox records with `ts >= 1769721533` are kept; everything else is dropped from derived files (never from raw).
- A boostbox record carries `source: "boostbox"` and `payment_hash` matching `/^[0-9a-f]{64}$/`; anything else is skipped.
- Bot raw path: `boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/incoming-ph-<payment_hash>.json`. Helipad raw paths do not change.
- Derived path: `boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json`. Nothing reads the old `boosts/derived/<week>.json`.
- Record key: `h:<index>` for Helipad (and for any record without `source`), `ph:<payment_hash>` for boostbox.
- MSP env: `MSP_BOT_INGEST_TOKEN`. Bot env: `BBN_FORWARD_URL`, `BBN_FORWARD_TOKEN` (same value as `MSP_BOT_INGEST_TOKEN`), `BBN_FORWARD_ACTIONS` (default `boost,auto,stream`).
- A bot-token request may store only boostbox records; a Helipad-token request only Helipad records.
- Ingest answers exactly 200 on success (Helipad's rule; the bot relies on it too).
- Keysend TLV is forwarded byte for byte. A BoostBox permalink is never put in `boost_link`.
- Forwarding requires URL, token **and** a non-empty `BBN_RECIPIENT_NAMES`.
- `forward-pending` holds at most 500 records, oldest dropped first; sends go in batches of 25; the Podcast Index lookup times out after 5 s.
- Nothing about the chart becomes public. The chart API stays admin-only (#140).
- MSP-2.0 checks: `npm run test`, `npm run build` (never `tsc --noEmit`), `npm run lint`, all clean. boostbox checks: `clojure -M:test`, and cljfmt clean on changed files.
- Commit messages: MSP-2.0 imperative ("Add …"); boostbox conventional (`feat(bot): …`). Every commit ends with the two attribution lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Nkgue6i8tacQG81M4sfC6C`.

## Review Focus

1. **A boost link whose metadata carries both BoostBox and blip-10 names** (`feed_guid` and `guid`): the blip-10 value must win, or MSP keys the boost on the wrong feed. Pinned in Task B2 (`blip10-names-win-over-boostbox-names`).
2. **Podcast Index answering a miss as `"episode": []`** rather than omitting it: must read as "not found" and store the record untitled, never throw. Pinned in Task A5.
3. **A record settled exactly at the cutover second:** the bot's is kept and Helipad's dropped, or the boundary boost counts twice or not at all. Pinned in Task A2.
4. **Forwarding configured on a bot with no recipient filter** (the Boostr bot, by accident): must forward nothing, or every split on the node — other shows' boosts and their listeners' messages — lands in MSP's store. Pinned in Tasks B2 and B3.
5. **A derived record written before sources existed** (no `source` field): must be treated as Helipad by both `selectSource` and `recordKey`. Pinned in Tasks A1 and A2.

## File Structure

MSP-2.0 (`~/Vibe/MSP-2.0`):

| File | Change | Responsibility |
|---|---|---|
| `api/_utils/boostRecord.ts` | modify | `BoostSource`, `BOOSTBOX_CUTOVER`, `recordKey`; parse boostbox records |
| `api/_utils/boostStore.ts` | modify | bot raw path, `selectSource`, key-based week write, `readStoredBoostboxRecords`, namespaced derived path |
| `api/_utils/boostChart.ts` | modify | sort tie-break by `recordKey` |
| `api/_utils/remoteItemLookup.ts` | **create** | Podcast Index title lookup and ingest enrichment |
| `api/boosts/ingest.ts` | modify | two tokens, source check, enrichment, importer keeps bot records |
| `api/boosts/rebuild.ts` | modify | admin-only `?week=` |
| `tools/migrate-derived-to-namespace.mjs` | **create** | one-off migration, compare, delete old public files |
| `CLAUDE.md` | modify | record the new source, cutover, private path |
| tests beside each | modify/create | `boostRecord.test.ts`, `boostStore.test.ts`, `remoteItemLookup.test.ts`, `ingest.test.ts`, `rebuild.test.ts` |

boostbox (`~/Vibe/boostbox`):

| File | Change | Responsibility |
|---|---|---|
| `src/boostbox/nwc.clj` | modify | `transaction->boost` carries `:tlv-json` / `:wallet-boostagram` |
| `src/boostbox/nostrbot.clj` | modify | `tx->boost!` carries `:link-metadata`; config; poll loop forwards |
| `src/boostbox/forward.clj` | **create** | record building, queue, forwarded set, HTTP send |
| `src/boostbox/forwardbackfill.clj` | **create** | one-off backfill entry point |
| `scripts/msp-forward-backfill.sh` | **create** | operator wrapper, prompts with echo off |
| `test/boostbox/forward_test.clj`, `test/boostbox/forwardbackfill_test.clj` | **create** | tests |
| `test/boostbox/nwc_test.clj`, `test/boostbox/nostrbot_test.clj` | modify | tests |
| `CLAUDE.md`, `README.md` | modify | docs |

---

# Part A — MSP-2.0

Setup, once: `cd ~/Vibe/MSP-2.0 && git switch -c feat/msp-bot-ingest docs/msp-bot-ingest-spec` (the branch carries the spec and this plan).

### Task A1: Parse boostbox records and key every record

**Files:**
- Modify: `api/_utils/boostRecord.ts` (types near line 65–138; `parseBoostPayload` at ~246; `toDerived` at ~374)
- Modify: `api/_utils/boostStore.ts` (`rawPath`, ~line 57)
- Test: `api/_utils/boostRecord.test.ts`, `api/_utils/boostStore.test.ts`

**Interfaces:**
- Produces: `export type BoostSource = 'helipad' | 'boostbox'`; `export const BOOSTBOX_CUTOVER = 1769721533`; `export function recordKey(r: { source?: BoostSource; index: number; paymentHash?: string }): string`; `ParsedBoost.source: BoostSource`, `ParsedBoost.paymentHash?: string`; `DerivedBoost.source?: BoostSource`, `DerivedBoost.paymentHash?: string`; `rawPath` files boostbox records as `incoming-ph-<hash>.json`.

- [ ] **Step 1: Write the failing tests** — append to `api/_utils/boostRecord.test.ts`, and add `recordKey` and `BOOSTBOX_CUTOVER` to its import from `./boostRecord.js`:

```ts
const HASH = 'a'.repeat(64);

/** What msp-bot sends: no Helipad index, a payment hash instead, everything else in tlv. */
function botBody(overrides: Record<string, unknown> = {}) {
  return {
    source: 'boostbox',
    payment_hash: HASH,
    direction: 'incoming',
    time: BOOSTBOX_CUTOVER + 3600,
    value_msat: 1000,
    tlv: JSON.stringify(V4VMUSIC_TLV),
    ...overrides
  };
}

describe('parseBoostPayload for msp-bot records', () => {
  it('takes the payment hash as the key when there is no Helipad index', () => {
    const parsed = parseBoostPayload(botBody())!;
    expect(parsed.source).toBe('boostbox');
    expect(parsed.paymentHash).toBe(HASH);
    expect(parsed.app).toBe('v4vmusic-com');
    expect(parsed.actionName).toBe('auto');
    expect(parsed.valueMsatTotal).toBe(100000);
    expect(isMspSplit(parsed)).toBe(true);
  });

  it('skips a bot record whose payment hash is not 64 lowercase hex characters', () => {
    for (const bad of [undefined, '', 'A'.repeat(64), 'a'.repeat(63), '../' + 'a'.repeat(61)]) {
      expect(parseBoostPayload(botBody({ payment_hash: bad }))).toBeNull();
    }
  });

  it('marks a Helipad record as helipad', () => {
    expect(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!.source).toBe('helipad');
  });

  it('carries the source and payment hash into the derived record', () => {
    const derived = toDerived(parseBoostPayload(botBody())!);
    expect(derived.source).toBe('boostbox');
    expect(derived.paymentHash).toBe(HASH);
  });
});

describe('recordKey', () => {
  it('keys Helipad on its index and the bot on its payment hash, so they never collide', () => {
    expect(recordKey(parseBoostPayload(webhookBody(V4VMUSIC_TLV))!)).toBe('h:10695');
    expect(recordKey(parseBoostPayload(botBody())!)).toBe(`ph:${HASH}`);
  });

  it('treats a derived record written before sources existed as Helipad', () => {
    expect(recordKey({ index: 7 })).toBe('h:7');
  });
});
```

And add to the `describe('paths', …)` block in `api/_utils/boostStore.test.ts`:

```ts
  it('files a bot record under its payment hash, beside the Helipad ones', () => {
    const bot = parseBoostPayload({
      source: 'boostbox',
      payment_hash: 'b'.repeat(64),
      direction: 'incoming',
      time: Math.floor(Date.UTC(2026, 7, 29) / 1000),
      tlv: '{}'
    })!;
    expect(rawPath(bot)).toBe(`boosts/raw/${NAMESPACE}/2026-08/incoming-ph-${'b'.repeat(64)}.json`);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run api/_utils/boostRecord.test.ts api/_utils/boostStore.test.ts`
Expected: FAIL — `recordKey` / `BOOSTBOX_CUTOVER` are not exported; `parseBoostPayload(botBody())` returns null (no `index`).

- [ ] **Step 3: Implement** — in `api/_utils/boostRecord.ts`:

Add after the `TrackSource` type:

```ts
/** Which system delivered a record. A record stored before this existed is Helipad's. */
export type BoostSource = 'helipad' | 'boostbox';

/** A Lightning payment hash: 32 bytes, lowercase hex. The bot's raw path is built from it. */
const PAYMENT_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Where msp-bot's history starts: its first-run watermark, 2026-01-29T21:18:53Z.
 * Measured on 2026-09-26, the bot holds every MSP split payment Helipad holds after this
 * instant, and 87 more, so the chart takes Helipad's records before it and the bot's
 * from it on. See docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md.
 */
export const BOOSTBOX_CUTOVER = 1769721533;

/** The key a derived week de-duplicates on. Helipad's index and the bot's hash never collide. */
export function recordKey(r: { source?: BoostSource; index: number; paymentHash?: string }): string {
  return r.source === 'boostbox' ? `ph:${r.paymentHash}` : `h:${r.index}`;
}
```

In `interface ParsedBoost`, after `index: number;` add:

```ts
  /** Helipad records carry `index`; msp-bot records carry `paymentHash` and index 0. */
  source: BoostSource;
  paymentHash?: string;
```

In `interface DerivedBoost`, after `index: number;` add:

```ts
  /** Absent on weeks written before msp-bot existed; read as 'helipad'. */
  source?: BoostSource;
  paymentHash?: string;
```

Replace the start of `parseBoostPayload` (from `const index = asNumber(b.index);` through `if (index === undefined) return null;`) with:

```ts
  const source: BoostSource = b.source === 'boostbox' ? 'boostbox' : 'helipad';
  let index: number | undefined;
  let paymentHash: string | undefined;
  if (source === 'boostbox') {
    // msp-bot has no LND invoice index; the payment hash is its unique key instead.
    const hash = asString(b.payment_hash);
    if (!hash || !PAYMENT_HASH_RE.test(hash)) return null;
    paymentHash = hash;
    index = 0;
  } else {
    index = asNumber(b.index);
    if (index === undefined) return null;
  }
```

and in its returned object, after `index,` add:

```ts
    source,
    ...(paymentHash ? { paymentHash } : {}),
```

In `toDerived`, after `index: boost.index,` add:

```ts
    source: boost.source,
    ...(boost.paymentHash ? { paymentHash: boost.paymentHash } : {}),
```

In `api/_utils/boostStore.ts`, replace `rawPath`:

```ts
export function rawPath(boost: ParsedBoost): string {
  const id = boost.source === 'boostbox' ? `ph-${boost.paymentHash}` : String(boost.index);
  return `${rawMonthPrefix(monthKey(boost.ts))}${boost.direction}-${id}.json`;
}
```

Update the file-header comment's first path line to read:
`boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index | ph-<payment_hash>>.json`

- [ ] **Step 4: Run the tests and the type check, and watch them pass**

Run: `npx vitest run api/_utils/boostRecord.test.ts api/_utils/boostStore.test.ts && npx tsc -b`
Expected: PASS, and no type errors. Vitest does not type-check; `source` is now a required `ParsedBoost` field, so `tsc -b` is what finds any other place that builds one by hand.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/boostRecord.ts api/_utils/boostStore.ts api/_utils/boostRecord.test.ts api/_utils/boostStore.test.ts
git commit -m "Accept msp-bot records keyed by payment hash"
```

---

### Task A2: One source per period — the cutover

**Files:**
- Modify: `api/_utils/boostStore.ts` (`replaceDerivedWeek`, ~line 255)
- Modify: `api/_utils/boostChart.ts:64`
- Test: `api/_utils/boostStore.test.ts`

**Interfaces:**
- Consumes: `BOOSTBOX_CUTOVER`, `BoostSource`, `recordKey` (Task A1).
- Produces: `export function selectSource<T extends { source?: BoostSource; ts: number }>(records: T[]): T[]`; `replaceDerivedWeek` applies it and de-duplicates on `recordKey`.

- [ ] **Step 1: Move the Helipad fixtures before the cutover.** Every Helipad fixture in `boostStore.test.ts` is dated 2026-08-29, which is after the cutover, so the new rule would drop them. Move them to 2025 outside the `weekBounds and monthsForWeek` block (those tests are about calendar arithmetic and keep 2026):

```bash
python3 - <<'EOF'
p = 'api/_utils/boostStore.test.ts'
s = open(p).read()
head, sep, rest = s.partition("describe('weekBounds and monthsForWeek'")
bounds, sep2, tail = rest.partition("describe('rebuildWeekFromRaw'")
def move(t):
    return (t.replace('Date.UTC(2026, 7, 29)', 'Date.UTC(2025, 7, 29)')
             .replace('Date.UTC(2026, 0, 8)', 'Date.UTC(2025, 0, 8)')
             .replace('/2026-08/', '/2025-08/')
             .replace("'2026-W35'", "'2025-W35'")
             .replace('boosts/derived/2026-W35.json', 'boosts/derived/2025-W35.json'))
assert sep and sep2
open(p, 'w').write(move(head) + sep + bounds + sep2 + move(tail))
EOF
npx vitest run api/_utils/boostStore.test.ts
```
Expected: PASS (2025-08-29 is still ISO week 35, and still one calendar month).

- [ ] **Step 2: Write the failing tests** — add `selectSource` to the import from `./boostStore.js` and `BOOSTBOX_CUTOVER` to the import from `./boostRecord.js`, then append:

```ts
describe('selectSource', () => {
  const helipadAt = (ts: number) => ({ source: 'helipad' as const, ts });
  const botAt = (ts: number) => ({ source: 'boostbox' as const, ts });

  it('keeps Helipad before the cutover and the bot from it on', () => {
    const records = [helipadAt(BOOSTBOX_CUTOVER - 1), botAt(BOOSTBOX_CUTOVER - 1),
      helipadAt(BOOSTBOX_CUTOVER + 1), botAt(BOOSTBOX_CUTOVER + 1)];
    expect(selectSource(records)).toEqual([helipadAt(BOOSTBOX_CUTOVER - 1), botAt(BOOSTBOX_CUTOVER + 1)]);
  });

  it('gives the cutover second itself to the bot', () => {
    expect(selectSource([botAt(BOOSTBOX_CUTOVER), helipadAt(BOOSTBOX_CUTOVER)]))
      .toEqual([botAt(BOOSTBOX_CUTOVER)]);
  });

  it('treats a record with no source as Helipad', () => {
    expect(selectSource([{ ts: BOOSTBOX_CUTOVER - 1 }, { ts: BOOSTBOX_CUTOVER }]))
      .toEqual([{ ts: BOOSTBOX_CUTOVER - 1 }]);
  });
});

describe('replaceDerivedWeek across sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    mockPut.mockResolvedValue({ url: 'https://blob.example/x' });
  });

  it('counts a boost once when Helipad and the bot both hold it, taking the bot after the cutover', async () => {
    const t = Math.floor(Date.UTC(2026, 7, 29) / 1000);
    const helipad = boost(1, { time: t });
    const bot = parseBoostPayload({
      source: 'boostbox', payment_hash: 'c'.repeat(64), direction: 'incoming',
      time: t, value_msat: 1000, tlv: JSON.stringify({ name: 'MSP 2.0' })
    })!;
    expect(await replaceDerivedWeek('2026-W35', [helipad, bot])).toBe(1);
    const written = JSON.parse(mockPut.mock.calls[0][1] as string);
    expect(written[0].source).toBe('boostbox');
  });

  it('keeps two bot records apart even though both carry index 0', async () => {
    const t = Math.floor(Date.UTC(2026, 7, 29) / 1000);
    const bot = (h: string) => parseBoostPayload({
      source: 'boostbox', payment_hash: h.repeat(64), direction: 'incoming', time: t, tlv: '{}'
    })!;
    expect(await replaceDerivedWeek('2026-W35', [bot('d'), bot('e'), bot('d')])).toBe(2);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run api/_utils/boostStore.test.ts`
Expected: FAIL — `selectSource` is not exported; the cross-source week writes 2 records, and the two bot records collapse to 1 on `index`.

- [ ] **Step 4: Implement** — in `api/_utils/boostStore.ts`, extend the imports:

```ts
import type { BoostSource, DerivedBoost, ParsedBoost } from './boostRecord.js';
import { BOOSTBOX_CUTOVER, isoWeekKey, monthKey, parseBoostPayload, recordKey, toDerived } from './boostRecord.js';
```

Add above `replaceDerivedWeek`:

```ts
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
```

Replace the body of `replaceDerivedWeek`:

```ts
  const byKey = new Map<string, DerivedBoost>();
  for (const record of selectSource(records)) {
    if (isoWeekKey(record.ts) !== weekKey) continue;
    byKey.set(recordKey(record), toDerived(record));
  }
  const week = [...byKey.values()]
    .sort((a, b) => a.ts - b.ts || recordKey(a).localeCompare(recordKey(b)));
  await putJson(derivedPath(weekKey), week, true);
  return week.length;
```

Update its comment's last sentence and the `rebuildWeekFromRaw` comment that says "replaceDerivedWeek dedupes on index" to say "dedupes on recordKey".

In `api/_utils/boostChart.ts`, add `recordKey` to the import from `./boostRecord.js` and change line 64:

```ts
    .sort((a, b) => a.ts - b.ts || recordKey(a).localeCompare(recordKey(b)));
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run api/_utils/ && npx tsc -b`
Expected: PASS, including `boostChart.test.ts` unchanged, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add api/_utils/boostStore.ts api/_utils/boostChart.ts api/_utils/boostStore.test.ts
git commit -m "Take Helipad's records before the cutover and msp-bot's after"
```

---

### Task A3: The importer keeps the bot's records

**Files:**
- Modify: `api/_utils/boostStore.ts` (`rebuildWeekFromRaw`, new `readStoredBoostboxRecords`)
- Modify: `api/boosts/ingest.ts` (the `if (week)` branch)
- Test: `api/_utils/boostStore.test.ts`, `api/boosts/ingest.test.ts`

**Interfaces:**
- Produces: `export async function readStoredBoostboxRecords(weekKey: string): Promise<ParsedBoost[]>`.

- [ ] **Step 1: Write the failing tests** — in `boostStore.test.ts`, add `readStoredBoostboxRecords` to the import and append:

```ts
describe('readStoredBoostboxRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
  });

  it("reads only the bot's raw records for the week, never fetching Helipad's", async () => {
    mockList.mockResolvedValue({
      blobs: [
        { pathname: `boosts/raw/${NAMESPACE}/2026-08/incoming-7.json`, url: 'https://blob.example/helipad-7' },
        { pathname: `boosts/raw/${NAMESPACE}/2026-08/incoming-ph-${'d'.repeat(64)}.json`, url: 'https://blob.example/bot-d' }
      ],
      cursor: undefined,
      hasMore: false
    });
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        receivedAt: 1, source: 'boostbox',
        payload: {
          source: 'boostbox', payment_hash: 'd'.repeat(64), direction: 'incoming',
          time: Math.floor(Date.UTC(2026, 7, 29) / 1000), tlv: '{}'
        }
      }))
    });

    const records = await readStoredBoostboxRecords('2026-W35');
    expect(records.map(r => r.paymentHash)).toEqual(['d'.repeat(64)]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://blob.example/bot-d');
  });
});
```

In `api/boosts/ingest.test.ts`, add `mockReadBot` to the hoisted mocks and `readStoredBoostboxRecords: mockReadBot` to the `vi.mock('../_utils/boostStore.js', …)` object; in `beforeEach` add `mockReadBot.mockResolvedValue([]);`; then add:

```ts
  it("keeps the bot's stored records when the importer rewrites a week", async () => {
    const botRecord = { source: 'boostbox', paymentHash: 'e'.repeat(64), index: 0, ts: 1756400000 };
    mockReadBot.mockResolvedValue([botRecord]);
    const { req, res } = createMockReqRes('POST', { week: '2025-W35', records: [webhookBody(1)] });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockReadBot).toHaveBeenCalledWith('2025-W35');
    const [, records] = mockReplaceWeek.mock.calls[0];
    expect(records).toHaveLength(2);
    expect(records).toContainEqual(botRecord);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run api/_utils/boostStore.test.ts api/boosts/ingest.test.ts`
Expected: FAIL — `readStoredBoostboxRecords` is not exported; the importer passes only its own record.

- [ ] **Step 3: Implement** — in `boostStore.ts`, add above `rebuildWeekFromRaw` and make `rebuildWeekFromRaw` use it:

```ts
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
```

In `rebuildWeekFromRaw`, replace everything from `const blobs = …` down to the end of the `for (const record of stored)` loop with:

```ts
  const records = await readRawWeek(weekKey);
```

(the `for (const record of extra)` loop and the rest stay as they are).

In `api/boosts/ingest.ts`, import `readStoredBoostboxRecords` from `../_utils/boostStore.js` and replace the week branch:

```ts
    if (week) {
      // The importer supplies Helipad's records only. The bot's stored records for the
      // week go into the same whole-week write, or re-running the importer would drop
      // them from the chart.
      const stored = await readStoredBoostboxRecords(week);
      weekSizes[week] = await replaceDerivedWeek(week, [...entries.map(e => e.parsed), ...stored]);
    } else {
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run api/_utils/boostStore.test.ts api/boosts/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/boostStore.ts api/boosts/ingest.ts api/_utils/boostStore.test.ts api/boosts/ingest.test.ts
git commit -m "Keep msp-bot's records when the Helipad importer rewrites a week"
```

---

### Task A4: Two tokens, each for its own source

**Files:**
- Modify: `api/boosts/ingest.ts` (auth block and parse loop; the header comment)
- Modify: `api/_utils/boostStore.ts` (`RawStoredBoost.source`)
- Test: `api/boosts/ingest.test.ts`

**Interfaces:**
- Consumes: `BoostSource`, `ParsedBoost.source` (Task A1).
- Produces: env `MSP_BOT_INGEST_TOKEN`; `RawStoredBoost.source: 'webhook' | 'import' | 'boostbox'`.

- [ ] **Step 1: Write the failing tests** — in `ingest.test.ts`, add near the top:

```ts
const BOT_TOKEN = 'bot-token-value-xyz';

function botBody(hash: string) {
  return {
    source: 'boostbox',
    payment_hash: hash,
    direction: 'incoming',
    time: 1790000000,
    value_msat: 1000,
    tlv: JSON.stringify({ name: 'MSP 2.0', action: 'boost', app_name: 'Castamatic' })
  };
}
```

In `beforeEach` add `process.env.MSP_BOT_INGEST_TOKEN = BOT_TOKEN;`. In the existing test `'is 404 until both the token and the namespace are configured'`, add `delete process.env.MSP_BOT_INGEST_TOKEN;` as its first line. Then add:

```ts
  it('stores a bot record sent with the bot token, labelled as the bot', async () => {
    const { req, res } = createMockReqRes('POST', botBody('f'.repeat(64)), { authorization: `Bearer ${BOT_TOKEN}` });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStoreRaw.mock.calls[0][1]).toBe('boostbox');
    expect(mockStoreRaw.mock.calls[0][0][0].parsed.paymentHash).toBe('f'.repeat(64));
  });

  it("refuses a bot record under Helipad's token, and a Helipad record under the bot's", async () => {
    const a = createMockReqRes('POST', botBody('f'.repeat(64)));
    await handler(a.req, a.res);
    expect(a.res.status).toHaveBeenCalledWith(400);

    const b = createMockReqRes('POST', webhookBody(1), { authorization: `Bearer ${BOT_TOKEN}` });
    await handler(b.req, b.res);
    expect(b.res.status).toHaveBeenCalledWith(400);
    expect(mockStoreRaw).not.toHaveBeenCalled();
  });

  it('works with only the bot token configured, and is 404 with neither', async () => {
    delete process.env.HELIPAD_WEBHOOK_TOKEN;
    const a = createMockReqRes('POST', botBody('f'.repeat(64)), { authorization: `Bearer ${BOT_TOKEN}` });
    await handler(a.req, a.res);
    expect(a.res.status).toHaveBeenCalledWith(200);

    delete process.env.MSP_BOT_INGEST_TOKEN;
    const b = createMockReqRes('POST', botBody('f'.repeat(64)), { authorization: `Bearer ${BOT_TOKEN}` });
    await handler(b.req, b.res);
    expect(b.res.status).toHaveBeenCalledWith(404);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run api/boosts/ingest.test.ts`
Expected: FAIL — the bot token gets 401; a bot record under Helipad's token is stored.

- [ ] **Step 3: Implement** — in `api/boosts/ingest.ts` import `type BoostSource` from `../_utils/boostRecord.js`, and replace the block from `const expectedToken = …` through the 401 check with:

```ts
  const helipadToken = process.env.HELIPAD_WEBHOOK_TOKEN;
  const botToken = process.env.MSP_BOT_INGEST_TOKEN;

  // 404 rather than 401 when unconfigured: until a token and the namespace are set the
  // feature does not exist, and saying so invites nobody to guess at a token.
  if ((!helipadToken && !botToken) || !isBoostStoreConfigured()) {
    return res.status(404).json({ error: 'Not found' });
  }

  const authHeader = req.headers['authorization'];
  const presented = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  // Constant-time, and the string variant on purpose: timingSafeEqualHex would run
  // Buffer.from(x, 'hex') over a free-form secret and compare two truncations equal.
  // Each token names its caller, and a caller may only write its own source's records.
  const caller: BoostSource | null =
    presented && helipadToken && timingSafeEqualString(presented, helipadToken) ? 'helipad'
    : presented && botToken && timingSafeEqualString(presented, botToken) ? 'boostbox'
    : null;

  if (!caller) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
```

In the parse loop, after `if (!parsed) { skipped += 1; continue; }` add:

```ts
    // A leaked bot token must not be able to forge Helipad history, nor the reverse.
    if (parsed.source !== caller) { skipped += 1; continue; }
```

Change the raw write's label:

```ts
    const result = await storeRawBoosts(entries, week ? 'import' : caller === 'boostbox' ? 'boostbox' : 'webhook');
```

In `api/_utils/boostStore.ts` change `source: 'webhook' | 'import';` in `RawStoredBoost` to `source: 'webhook' | 'import' | 'boostbox';`.

Extend the handler's header comment with one paragraph:

```ts
 * A second caller, msp-bot (boostbox), posts the same record shape with
 * `source: "boostbox"` and a `payment_hash` in place of `index`, under its own
 * MSP_BOT_INGEST_TOKEN. Since 2026-09-26 it is the chart's live source; Helipad's
 * records count only before BOOSTBOX_CUTOVER (see boostRecord.ts).
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run api/boosts/ingest.test.ts`
Expected: PASS, the existing tests included.

- [ ] **Step 5: Commit**

```bash
git add api/boosts/ingest.ts api/_utils/boostStore.ts api/boosts/ingest.test.ts
git commit -m "Give msp-bot its own ingest token, limited to its own records"
```

---

### Task A5: Song titles from Podcast Index

**Files:**
- Create: `api/_utils/remoteItemLookup.ts`
- Create: `api/_utils/remoteItemLookup.test.ts`
- Modify: `api/boosts/ingest.ts` (after the parse loop)
- Modify: `api/boosts/ingest.test.ts`

**Interfaces:**
- Consumes: `getAuthHeaders(): Record<string, string> | null` from `api/_utils/podcastIndex.ts`; `parseBoostPayload`, `ParsedBoost`.
- Produces: `export async function lookupRemoteItem(feedGuid: string, itemGuid: string): Promise<{ remoteEpisode: string; remotePodcast?: string } | null>`; `export async function enrichWithRemoteTitles<E extends { parsed: ParsedBoost; payload: unknown }>(entries: E[]): Promise<E[]>`.

- [ ] **Step 1: Write the failing tests** — create `api/_utils/remoteItemLookup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHeaders } = vi.hoisted(() => ({ mockHeaders: vi.fn() }));
vi.mock('./podcastIndex.js', () => ({ getAuthHeaders: mockHeaders }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { lookupRemoteItem, enrichWithRemoteTitles } from './remoteItemLookup.js';
import { parseBoostPayload } from './boostRecord.js';

const FEED = '917393e3-1b1e-5cef-ace4-edaa54e1f810';
const ITEM = 'song-guid-1';
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function botEntry(tlv: Record<string, unknown>, outer: Record<string, unknown> = {}) {
  const payload = {
    source: 'boostbox', payment_hash: 'a'.repeat(64), direction: 'incoming',
    time: 1790000000, value_msat: 1000, tlv: JSON.stringify(tlv), ...outer
  };
  return { parsed: parseBoostPayload(payload)!, payload };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockReturnValue({ 'X-Auth-Key': 'k' });
});

describe('lookupRemoteItem', () => {
  it('asks Podcast Index for the item within its feed and returns both titles', async () => {
    mockFetch.mockReturnValue(ok({ status: 'true', episode: { title: 'Nede ved Myre', feedTitle: 'Transcendental Object' } }));
    expect(await lookupRemoteItem(FEED, ITEM))
      .toEqual({ remoteEpisode: 'Nede ved Myre', remotePodcast: 'Transcendental Object' });
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('https://api.podcastindex.org/api/1.0/episodes/byguid?');
    expect(url).toContain(`guid=${ITEM}`);
    expect(url).toContain(`podcastguid=${FEED}`);
  });

  it('reads a miss answered as an empty array as nothing found', async () => {
    mockFetch.mockReturnValue(ok({ status: 'true', episode: [] }));
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
  });

  it('gives up quietly on an error, a timeout, or missing credentials', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted'));
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
    mockHeaders.mockReturnValue(null);
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
  });
});

describe('enrichWithRemoteTitles', () => {
  it('adds the titles to a bot record before it is stored, and says where they came from', async () => {
    mockFetch.mockReturnValue(ok({ episode: { title: 'Song', feedTitle: 'Album' } }));
    const [entry] = await enrichWithRemoteTitles([
      botEntry({ name: 'MSP 2.0', remote_feed_guid: FEED, remote_item_guid: ITEM })
    ]);
    expect(entry.parsed.remoteEpisode).toBe('Song');
    expect(entry.parsed.remotePodcast).toBe('Album');
    expect(entry.payload).toMatchObject({ remote_episode: 'Song', remote_podcast: 'Album', resolved_by: 'podcastindex' });
  });

  it('leaves a record as it was when the lookup finds nothing', async () => {
    mockFetch.mockReturnValue(ok({ episode: [] }));
    const original = botEntry({ remote_feed_guid: FEED, remote_item_guid: ITEM });
    const [entry] = await enrichWithRemoteTitles([original]);
    expect(entry).toBe(original);
  });

  it('never looks up a Helipad record, or a bot record that already has a title', async () => {
    const helipad = {
      parsed: parseBoostPayload({ index: 1, direction: 'incoming', time: 1, tlv: JSON.stringify({ remote_feed_guid: FEED, remote_item_guid: ITEM }) })!,
      payload: {}
    };
    const titled = botEntry({ remote_feed_guid: FEED, remote_item_guid: ITEM }, { remote_episode: 'Known' });
    await enrichWithRemoteTitles([helipad, titled]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

In `ingest.test.ts` add a hoisted `mockEnrich`, `vi.mock('../_utils/remoteItemLookup.js', () => ({ enrichWithRemoteTitles: mockEnrich }));`, in `beforeEach` `mockEnrich.mockImplementation(async (entries: unknown[]) => entries);`, and:

```ts
  it('stores what the Podcast Index step returns, not what arrived', async () => {
    const enriched = [{ parsed: { source: 'boostbox', paymentHash: 'f'.repeat(64), index: 0, ts: 1790000000, direction: 'incoming' }, payload: { marker: true } }];
    mockEnrich.mockResolvedValue(enriched);
    const { req, res } = createMockReqRes('POST', botBody('f'.repeat(64)), { authorization: `Bearer ${BOT_TOKEN}` });
    await handler(req, res);
    expect(mockEnrich).toHaveBeenCalledTimes(1);
    expect(mockStoreRaw.mock.calls[0][0]).toBe(enriched);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run api/_utils/remoteItemLookup.test.ts api/boosts/ingest.test.ts`
Expected: FAIL — `./remoteItemLookup.js` does not exist.

- [ ] **Step 3: Implement** — create `api/_utils/remoteItemLookup.ts`:

```ts
import { getAuthHeaders } from './podcastIndex.js';
import { parseBoostPayload } from './boostRecord.js';
import type { ParsedBoost } from './boostRecord.js';

const PI_BASE = 'https://api.podcastindex.org/api/1.0';
const TIMEOUT_MS = 5000;

export interface RemoteItemTitles {
  remoteEpisode: string;
  remotePodcast?: string;
}

/**
 * A remote item's title and its feed's title, from Podcast Index — the two fields
 * Helipad fills itself as `remote_episode` / `remote_podcast`. The API answers a miss
 * with `"episode": []` rather than omitting it, which reads here as nothing found.
 * Null on any failure: a missing title falls back to the listener's message, and a
 * boost is never refused because Podcast Index was slow.
 */
export async function lookupRemoteItem(feedGuid: string, itemGuid: string): Promise<RemoteItemTitles | null> {
  const headers = getAuthHeaders();
  if (!headers) return null;
  const url = `${PI_BASE}/episodes/byguid?guid=${encodeURIComponent(itemGuid)}&podcastguid=${encodeURIComponent(feedGuid)}`;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json() as { episode?: { title?: unknown; feedTitle?: unknown } };
    const episode = body.episode;
    const title = typeof episode?.title === 'string' ? episode.title.trim() : '';
    if (!title) return null;
    const feedTitle = typeof episode?.feedTitle === 'string' ? episode.feedTitle.trim() : '';
    return { remoteEpisode: title, ...(feedTitle ? { remotePodcast: feedTitle } : {}) };
  } catch {
    return null;
  }
}

/**
 * For msp-bot's records, do at ingest what Helipad did itself: add the remote item's
 * titles before the raw write, so a rebuild never needs Podcast Index again. Lookups run
 * in parallel so a batch fits the function timeout even when every one times out.
 */
export async function enrichWithRemoteTitles<E extends { parsed: ParsedBoost; payload: unknown }>(
  entries: E[]
): Promise<E[]> {
  return Promise.all(entries.map(async (entry) => {
    const { parsed } = entry;
    const feedGuid = typeof parsed.tlv.remote_feed_guid === 'string' ? parsed.tlv.remote_feed_guid : '';
    const itemGuid = typeof parsed.tlv.remote_item_guid === 'string' ? parsed.tlv.remote_item_guid : '';
    if (parsed.source !== 'boostbox' || !feedGuid || !itemGuid || parsed.remoteEpisode) return entry;

    const found = await lookupRemoteItem(feedGuid, itemGuid);
    if (!found) return entry;

    const payload = {
      ...(entry.payload as Record<string, unknown>),
      remote_episode: found.remoteEpisode,
      ...(found.remotePodcast ? { remote_podcast: found.remotePodcast } : {}),
      resolved_by: 'podcastindex'
    };
    const reparsed = parseBoostPayload(payload);
    return reparsed ? { ...entry, parsed: reparsed, payload } : entry;
  }));
}
```

In `api/boosts/ingest.ts` import `enrichWithRemoteTitles` from `../_utils/remoteItemLookup.js`. Change `const entries` to `let entries` and, directly after the `if (week) { … strays … }` block and before the `try {`, add:

```ts
  // Helipad resolves a remote item's titles itself; for msp-bot's records MSP does it
  // here, before the raw write, so the resolver's remote-guid rung keeps its names.
  entries = await enrichWithRemoteTitles(entries);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run api/_utils/remoteItemLookup.test.ts api/boosts/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/remoteItemLookup.ts api/_utils/remoteItemLookup.test.ts api/boosts/ingest.ts api/boosts/ingest.test.ts
git commit -m "Fill msp-bot's song titles from Podcast Index, as Helipad did"
```

---

### Task A6: Private weekly files, and the migration

**Files:**
- Modify: `api/_utils/boostStore.ts` (`DERIVED_PREFIX`, `derivedPath`, `readAllDerived`, header comment)
- Modify: `api/boosts/rebuild.ts` (auth and weeks)
- Create: `tools/migrate-derived-to-namespace.mjs`
- Test: `api/_utils/boostStore.test.ts`, `api/boosts/rebuild.test.ts`

**Interfaces:**
- Produces: `export function derivedPrefix(): string` (`boosts/derived/<ns>/`); `derivedPath(weekKey)` under it; `GET /api/boosts/rebuild?week=<key>` (admin only).

- [ ] **Step 1: Write the failing tests** — in `boostStore.test.ts`, replace the test `'buckets derived by ISO week, with no namespace since it holds nothing private'` with:

```ts
  it('puts derived weeks behind the namespace too, since they carry per-boost amounts', () => {
    expect(derivedPath('2025-W35')).toBe(`boosts/derived/${NAMESPACE}/2025-W35.json`);
  });
```

Replace every remaining expectation of `'boosts/derived/2025-W35.json'` with `` `boosts/derived/${NAMESPACE}/2025-W35.json` `` (two places: the rebuild test and `'writes the whole week and reports its size'`). Add `readAllDerived` to the import and append:

```ts
describe('readAllDerived', () => {
  it('reads only the namespaced weekly files, never the old public ones', async () => {
    vi.clearAllMocks();
    process.env.MSP_BOOST_NAMESPACE = NAMESPACE;
    mockList.mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false });
    await readAllDerived();
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ prefix: `boosts/derived/${NAMESPACE}/` }));
  });
});
```

In `rebuild.test.ts`, change the helper to `function createMockReqRes(method = 'GET', headers: Record<string, string> = {}, query: Record<string, string> = {})` with `const req = { method, query, headers } …`, and add:

```ts
  it('rebuilds one named week for an admin, and nothing else', async () => {
    process.env.MSP_ADMIN_KEY = 'admin-key-value';
    const { req, res } = createMockReqRes('GET', { 'x-admin-key': 'admin-key-value' }, { week: '2026-W10' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith('2026-W10');
  });

  it('refuses a named week from the cron, which never sends one', async () => {
    const { req, res } = createMockReqRes('GET', { authorization: `Bearer ${CRON_SECRET}` }, { week: '2026-W10' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it('refuses a malformed week key', async () => {
    process.env.MSP_ADMIN_KEY = 'admin-key-value';
    const { req, res } = createMockReqRes('GET', { 'x-admin-key': 'admin-key-value' }, { week: '2026-10' });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run api/_utils/boostStore.test.ts api/boosts/rebuild.test.ts`
Expected: FAIL — derived paths have no namespace; `?week=` is ignored.

- [ ] **Step 3: Implement** — in `boostStore.ts`, remove `export const DERIVED_PREFIX = 'boosts/derived/';` and add after `rawMonthPrefix`:

```ts
/**
 * Weekly chart files, behind the same secret namespace as raw. They are public blobs at
 * fixed names and carry per-boost amounts the chart itself never shows, so a guessable
 * path would publish them. Until 2026-09-26 they lived at boosts/derived/<week>.json;
 * tools/migrate-derived-to-namespace.mjs moved them.
 */
export function derivedPrefix(): string {
  return `boosts/derived/${namespace()}/`;
}
```

Change `derivedPath` to `return \`${derivedPrefix()}${weekKey}.json\`;` and in `readAllDerived` change `listAll(DERIVED_PREFIX)` to `listAll(derivedPrefix())`. Update the file-header comment's derived line to `boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json`. Run `grep -rn DERIVED_PREFIX api src tools` and confirm no other use remains.

In `api/boosts/rebuild.ts`, add `const WEEK_RE = /^\d{4}-W\d{2}$/;` and replace the section from `// Three ways in` through `const weeks = [recentWeek(0), recentWeek(1)];` with:

```ts
  // Three ways in, and no fourth. With CRON_SECRET unset the cron path simply cannot
  // authenticate — it never falls back to open, which is the failure mode that matters
  // for an endpoint that rewrites stored data.
  const cron = isCronCaller(req);
  const admin = isLegacyAdmin(req)
    || (await parseAuthHeader(req.headers['authorization'] as string | undefined)).valid;

  if (!cron && !admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // A named week is a manual repair — the derived-path migration walks every week this
  // way. The cron never names one, so only an admin may.
  const requested = typeof req.query.week === 'string' ? req.query.week : undefined;
  if (requested !== undefined) {
    if (!WEEK_RE.test(requested)) {
      return res.status(400).json({ error: 'week must be an ISO week key, e.g. 2026-W35' });
    }
    if (!admin) {
      return res.status(403).json({ error: 'Only an admin may rebuild a named week' });
    }
  }

  try {
    const weeks = requested ? [requested] : [recentWeek(0), recentWeek(1)];
```

Create `tools/migrate-derived-to-namespace.mjs`:

```js
// One-off: move the weekly chart files under MSP_BOOST_NAMESPACE
// (docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md, section 4).
//
//   node tools/migrate-derived-to-namespace.mjs               rebuild every week, compare
//   node tools/migrate-derived-to-namespace.mjs --delete-old  ...then delete the old public files
//
// Needs BLOB_READ_WRITE_TOKEN (to list and delete) and MSP_ADMIN_KEY (to call the
// deployed /api/boosts/rebuild), from the environment or from the file named by ENVFILE.
// Prints neither. Run it only after the namespaced-path code is deployed.
import { list, del } from '@vercel/blob';
import { readFileSync } from 'node:fs';

const BASE = process.env.MSP_BASE_URL || 'https://musicsideproject.com';
// Weeks wholly before the cutover must match exactly; later weeks lose Helipad's
// post-cutover records until msp-bot's backfill runs.
const CUTOVER_WEEK = '2026-W05';
const OLD = /^boosts\/derived\/(\d{4}-W\d{2})\.json$/;

if (process.env.ENVFILE) {
  for (const line of readFileSync(process.env.ENVFILE, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
const adminKey = process.env.MSP_ADMIN_KEY;
if (!token || !adminKey) {
  console.error('BLOB_READ_WRITE_TOKEN and MSP_ADMIN_KEY are both required');
  process.exit(1);
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, token });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const old = (await listAll('boosts/derived/'))
  .filter(b => OLD.test(b.pathname))
  .sort((a, b) => a.pathname.localeCompare(b.pathname));
console.log(`old public weekly files: ${old.length}`);

let mismatches = 0;
for (const blob of old) {
  const week = OLD.exec(blob.pathname)[1];
  const oldCount = (await (await fetch(blob.url)).json()).length;
  const res = await fetch(`${BASE}/api/boosts/rebuild?week=${week}`, { headers: { 'x-admin-key': adminKey } });
  if (!res.ok) {
    console.error(`${week}: rebuild failed with ${res.status}; stopping`);
    process.exit(1);
  }
  const newCount = (await res.json()).rebuilt[week] ?? 0;
  const comparable = week < CUTOVER_WEEK;
  const mismatch = comparable && newCount !== oldCount;
  if (mismatch) mismatches += 1;
  console.log(`${week}  old ${oldCount}  new ${newCount}` +
    (comparable ? '' : '  (after the cutover: fills in after the bot backfill)') +
    (mismatch ? '  <-- MISMATCH' : ''));
}

if (mismatches > 0) {
  console.error(`${mismatches} week(s) before the cutover differ; deleting nothing`);
  process.exit(1);
}
if (process.argv.includes('--delete-old')) {
  await del(old.map(b => b.url), { token });
  console.log(`deleted ${old.length} old public weekly files`);
} else {
  console.log('checks passed; run again with --delete-old to delete the old public files');
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run api/_utils/boostStore.test.ts api/boosts/rebuild.test.ts && node --check tools/migrate-derived-to-namespace.mjs`
Expected: PASS, and no syntax error.

- [ ] **Step 5: Commit**

```bash
git add api/_utils/boostStore.ts api/boosts/rebuild.ts tools/migrate-derived-to-namespace.mjs api/_utils/boostStore.test.ts api/boosts/rebuild.test.ts
git commit -m "Move the weekly chart files behind the boost namespace"
```

---

### Task A7: Document, verify, open the PR

**Files:**
- Modify: `CLAUDE.md` (section "Boost capture (Helipad → MSP)")

- [ ] **Step 1: Update `CLAUDE.md`.** In "Boost capture (Helipad → MSP)", change the heading to `### Boost capture (msp-bot, formerly Helipad → MSP)` and insert this paragraph directly under it:

```markdown
**Since 2026-09-26 msp-bot is the live source, and Helipad's webhook is retired.**
boostbox's `msp-bot` reads the node's Alby Hub wallet over NWC and POSTs every MSP split
payment — boosts, auto-boosts and streams — to `/api/boosts/ingest` with
`source: "boostbox"`, a `payment_hash` in place of `index`, and its own
`MSP_BOT_INGEST_TOKEN`; each token may write only its own source's records. Measured on
2026-09-26, the bot held all 252 of Helipad's MSP boosts since 2026-01-29 and 87 more,
mostly lightning-address (LNURL) payments whose metadata only a boost link carries —
StableKraft, Castamatic and candr.space never reached Helipad at all. Derived weeks take
**Helipad's records before `BOOSTBOX_CUTOVER` (2026-01-29T21:18:53Z) and the bot's from it
on** (`selectSource`), keyed `h:<index>` / `ph:<payment_hash>` (`recordKey`); Helipad raw
records after the cutover are kept and never counted. The importer's whole-week write
reads the week's bot records first (`readStoredBoostboxRecords`), or re-running it would
drop them. For bot records that name a remote item, ingest fills `remote_episode` /
`remote_podcast` from Podcast Index before the raw write (`enrichWithRemoteTitles`),
which is what Helipad used to do.
```

In the "**Storage**" paragraph, change `boosts/derived/<isoYear>-W<week>.json` (PII-free, …)` to read:

```markdown
`boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json` (PII-free but carrying
per-boost amounts, so behind the namespace too since 2026-09-26; weekly because that is
the unit the chart reports in)
```

- [ ] **Step 2: Run every check**

Run: `npm run test && npm run build && npm run lint`
Expected: all tests pass (count them; the total grows from 636), the build prints `✓ built`, lint prints nothing. Report failures by name.

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "Document msp-bot as the chart's source"
git push -u origin feat/msp-bot-ingest
gh pr create --base master --title "Take the chart's boosts from msp-bot instead of Helipad" --body-file <(cat <<'EOF'
Implements docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md, Part A of the plan in docs/superpowers/plans/.

- msp-bot records (`source: "boostbox"`, `payment_hash`) at `/api/boosts/ingest`, under their own `MSP_BOT_INGEST_TOKEN`
- Cutover: Helipad before 2026-01-29T21:18:53Z, msp-bot from then on
- The Helipad importer keeps the week's bot records
- Podcast Index fills remote-item titles for bot records
- Weekly files move behind `MSP_BOOST_NAMESPACE`; `tools/migrate-derived-to-namespace.mjs` does the move

Rollout order and checks: Part C of the plan. After deploy the admin chart is empty until the migration runs.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Nkgue6i8tacQG81M4sfC6C
EOF
)
```

---

# Part B — boostbox

Setup, once: `cd ~/Vibe/boostbox && git switch main && git pull --ff-only && git switch -c feat/msp-forward`.

Run one namespace's tests with `clojure -M:test --focus boostbox.forward-test` (repeat `--focus` for more). The full suite is `clojure -M:test` (S3 tests need MinIO and are skipped here).

### Task B1: Carry the payer's original metadata through

**Files:**
- Modify: `src/boostbox/nwc.clj` (`transaction->boost`, ~line 259)
- Modify: `src/boostbox/nostrbot.clj` (`tx->boost!`, ~line 291)
- Test: `test/boostbox/nwc_test.clj`, `test/boostbox/nostrbot_test.clj`

**Interfaces:**
- Produces: a boost result from `nwc/transaction->boost` carries `:tlv-json` (the decoded TLV string) when it came from the TLV, else `:wallet-boostagram` (the wallet's parsed map); a boost result from `bot/tx->boost!` via a boost link carries `:link-metadata` (the map the link returned, before `bg/normalize`).

- [ ] **Step 1: Write the failing tests** — in `test/boostbox/nwc_test.clj` (add `[boostbox.nostr :as nostr]` and `[jsonista.core :as json]` to the `:require` if absent):

```clojure
(deftest a-boost-carries-its-tlv-exactly-as-the-payer-wrote-it
  ;; bg/normalize folds boost_link into :url; MSP's song resolver keys on boost_link,
  ;; so the forwarder needs the original, not the normalized map
  (let [tlv (json/write-value-as-string {"action" "boost" "name" "MSP 2.0"
                                         "boost_link" "https://v4vmusic.com/songs/x"
                                         "value_msat_total" 2100000})
        tx {"payment_hash" "h" "amount" 21000 "settled_at" 1
            "metadata" {"tlv_records" [{"type" 7629169
                                        "value" (nostr/bytes->hex (.getBytes tlv "UTF-8"))}]}}
        b (nwc/transaction->boost tx)]
    (is (= tlv (:tlv-json b)) "byte for byte, boost_link included")
    (is (nil? (:wallet-boostagram b)))))

(deftest a-wallet-parsed-boost-carries-the-wallets-map
  (let [parsed {"action" "boost" "podcast" "Show" "name" "MSP 2.0"}
        b (nwc/transaction->boost {"payment_hash" "h" "amount" 1 "settled_at" 1
                                   "metadata" {"boostagram" parsed}})]
    (is (= parsed (:wallet-boostagram b)))
    (is (nil? (:tlv-json b)))))
```

In `test/boostbox/nostrbot_test.clj`, next to `a-boost-link-supplies-the-metadata-an-lnurl-payment-cannot-carry`:

```clojure
(deftest a-linked-boost-carries-the-metadata-the-link-returned
  (with-redefs [bot/fetch-boost-metadata! (fn [_] linked-metadata)]
    (is (= linked-metadata (:link-metadata (bot/tx->boost! (ctx (atom {})) link-tx))))))
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `clojure -M:test --focus boostbox.nwc-test --focus boostbox.nostrbot-test`
Expected: FAIL — the three new keys are absent.

- [ ] **Step 3: Implement** — in `nwc/transaction->boost`, bind two more locals and extend the boost branch:

```clojure
   (let [raw (boostagram-tlv tx)
         b (extract-boostagram tx)
         ;; the payer's own bytes, for boostbox.forward: MSP must see what Helipad saw
         tlv-json (some-> raw decode-tlv-value)
         wallet (get-in tx ["metadata" "boostagram"])]
     (cond
       ...
       (and b (bg/boost? b actions))
       (cond-> {:payment-hash (get tx "payment_hash")
                :boostagram b
                :received-msat (->long (get tx "amount"))
                :settled-at (->long (get tx "settled_at"))}
         tlv-json (assoc :tlv-json tlv-json)
         (and (nil? tlv-json) (map? wallet)) (assoc :wallet-boostagram wallet))
       ...
```

In `bot/tx->boost!`, keep the fetched map before normalizing:

```clojure
      (if-let [url (bg/boost-link (get tx "description") (:boost-link-origins ctx))]
        (let [linked (fetch-boost-metadata! url)
              b (some-> linked bg/normalize)]
```

and add to the boost map it returns, after `:boost-id (bg/boost-id-from-url url)`:

```clojure
                 ;; the link's own map, before normalizing, for boostbox.forward
                 :link-metadata linked
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `clojure -M:test --focus boostbox.nwc-test --focus boostbox.nostrbot-test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/boostbox/nwc.clj src/boostbox/nostrbot.clj test/boostbox/nwc_test.clj test/boostbox/nostrbot_test.clj
git commit -m "feat(bot): keep each boost's original metadata for forwarding"
```

---

### Task B2: The forwarding namespace

**Files:**
- Create: `src/boostbox/forward.clj`
- Create: `test/boostbox/forward_test.clj`

**Interfaces:**
- Consumes: boost results with `:payment-hash :received-msat :settled-at :boostagram` and one of `:tlv-json :link-metadata :wallet-boostagram` (Task B1).
- Produces (all in `boostbox.forward`): `max-pending` (500), `max-forwarded` (2000), `batch-size` (25); `(env-config get-env) → {:forward-url :forward-token :forward-actions}`; `(enabled? ctx) → boolean`; `(link-metadata->tlv m) → map`; `(->record boost) → map` (Helipad-shaped, string keys); `(forwarded? state hash) → boolean`; `(send! ctx records) → {:ok? :status :error}`; `(forward! ctx state boosts) → {:state :sent :queued :dropped}`. State keys: `"forwarded"` (vector of hashes), `"forward-pending"` (vector of records).

- [ ] **Step 1: Write the failing tests** — create `test/boostbox/forward_test.clj`:

```clojure
(ns boostbox.forward-test
  (:require [clojure.test :refer [deftest testing is]]
            [babashka.http-client :as http]
            [boostbox.boostagram :as bg]
            [boostbox.forward :as fwd]
            [jsonista.core :as json]))

(def tlv-json
  (json/write-value-as-string {"action" "auto" "name" "MSP 2.0" "app_name" "v4vmusic-com"
                               "boost_link" "https://v4vmusic.com/songs/x"
                               "value_msat_total" 100000}))

(defn- boost [hash & {:as extra}]
  (merge {:payment-hash hash :received-msat 1000 :settled-at 1790000000
          :boostagram (bg/normalize (json/read-value tlv-json))
          :tlv-json tlv-json}
         extra))

;; ~~~~~~~~~~~~~~~~~~~ Records ~~~~~~~~~~~~~~~~~~~

(deftest a-keysend-record-carries-its-tlv-untouched
  (is (= {"source" "boostbox" "payment_hash" "h1" "direction" "incoming"
          "time" 1790000000 "value_msat" 1000 "tlv" tlv-json}
         (fwd/->record (boost "h1")))))

(deftest a-linked-record-never-carries-the-permalink-as-boost-link
  (let [linked {"action" "boost" "recipient_name" "MSP 2.0" "feed_guid" "fg" "item_guid" "ig"
                "feed_title" "Show" "item_title" "Ep" "position" 42 "group" "u1"
                "boost_link" "https://tardbox.com/boost/01X" "message" "hi"}
        tlv (json/read-value (get (fwd/->record (boost "h2" :tlv-json nil :link-metadata linked)) "tlv"))]
    (is (= {"action" "boost" "name" "MSP 2.0" "guid" "fg" "episode_guid" "ig" "podcast" "Show"
            "episode" "Ep" "ts" 42 "uuid" "u1" "message" "hi"}
           tlv))))

(deftest blip10-names-win-over-boostbox-names
  (is (= "blip" (get (fwd/link-metadata->tlv {"guid" "blip" "feed_guid" "bb"}) "guid"))))

(deftest a-wallet-parsed-record-sends-the-wallets-map
  (let [wallet {"action" "boost" "name" "MSP 2.0" "podcast" "Show"}]
    (is (= wallet (json/read-value (get (fwd/->record (boost "h3" :tlv-json nil :wallet-boostagram wallet)) "tlv"))))))

(deftest a-record-with-no-source-data-is-rebuilt-from-the-boostagram
  (let [tlv (json/read-value (get (fwd/->record (boost "h4" :tlv-json nil)) "tlv"))]
    (is (= "MSP 2.0" (get tlv "name")))
    (is (= "auto" (get tlv "action")))
    (is (= 100000 (get tlv "value_msat_total")))))

;; ~~~~~~~~~~~~~~~~~~~ Config ~~~~~~~~~~~~~~~~~~~

(deftest forward-config-defaults-to-all-three-actions
  (let [env {"BBN_FORWARD_URL" " https://msp.example/api/boosts/ingest " "BBN_FORWARD_TOKEN" "tok"}
        cfg (fwd/env-config (fn [k d] (get env k d)))]
    (is (= "https://msp.example/api/boosts/ingest" (:forward-url cfg)))
    (is (= "tok" (:forward-token cfg)))
    (is (= #{"boost" "auto" "stream"} (:forward-actions cfg)))))

(deftest forwarding-needs-a-url-a-token-and-a-recipient-filter
  (is (fwd/enabled? {:forward-url "u" :forward-token "t" :recipient-names #{"msp 2.0"}}))
  (is (not (fwd/enabled? {:forward-url "u" :forward-token "t" :recipient-names #{}}))
      "without a filter every split on the node would go to MSP")
  (is (not (fwd/enabled? {:forward-url "u" :recipient-names #{"msp 2.0"}}))))

;; ~~~~~~~~~~~~~~~~~~~ Sending ~~~~~~~~~~~~~~~~~~~

(deftest send-posts-a-json-array-with-the-bearer-token
  (let [seen (atom nil)]
    (with-redefs [http/post (fn [url opts] (reset! seen [url opts]) {:status 200})]
      (is (:ok? (fwd/send! {:forward-url "https://msp.example/i" :forward-token "tok"} [{"a" 1}])))
      (let [[url opts] @seen]
        (is (= "https://msp.example/i" url))
        (is (= "Bearer tok" (get-in opts [:headers "authorization"])))
        (is (= [{"a" 1}] (json/read-value (:body opts))))))
    (with-redefs [http/post (fn [_ _] {:status 201})]
      (is (not (:ok? (fwd/send! {:forward-url "u" :forward-token "t"} [{}]))) "only exactly 200 counts"))
    (with-redefs [http/post (fn [_ _] (throw (ex-info "connection refused" {})))]
      (is (not (:ok? (fwd/send! {:forward-url "u" :forward-token "t"} [{}])))))))

(deftest forward-sends-new-boosts-and-remembers-them
  (let [sent (atom [])]
    (with-redefs [fwd/send! (fn [_ batch] (swap! sent conj (mapv #(get % "payment_hash") batch)) {:ok? true :status 200})]
      (let [{:keys [state] :as r} (fwd/forward! {} {} [(boost "a") (boost "b")])]
        (is (= 2 (:sent r)))
        (is (= [["a" "b"]] @sent))
        (is (fwd/forwarded? state "a"))
        (testing "a second pass sends nothing"
          (reset! sent [])
          (fwd/forward! {} state [(boost "a")])
          (is (empty? @sent)))))))

(deftest a-failed-send-is-queued-and-retried-oldest-first
  (let [ok? (atom false)
        sent (atom [])]
    (with-redefs [fwd/send! (fn [_ batch]
                              (swap! sent conj (mapv #(get % "payment_hash") batch))
                              {:ok? @ok? :status (if @ok? 200 503)})]
      (let [{s1 :state :as r1} (fwd/forward! {} {} [(boost "old")])]
        (is (= 1 (:queued r1)))
        (is (not (fwd/forwarded? s1 "old")))
        (reset! ok? true)
        (reset! sent [])
        (let [{s2 :state} (fwd/forward! {} s1 [(boost "new")])]
          (is (= [["old" "new"]] @sent) "the queue goes first, in the same batch")
          (is (empty? (get s2 "forward-pending")))
          (is (every? #(fwd/forwarded? s2 %) ["old" "new"])))))))

(deftest a-queued-boost-is-not-sent-twice-in-one-pass
  (let [sent (atom [])]
    (with-redefs [fwd/send! (fn [_ batch] (swap! sent into (map #(get % "payment_hash") batch)) {:ok? true :status 200})]
      (fwd/forward! {} {"forward-pending" [(fwd/->record (boost "q"))]} [(boost "q")])
      (is (= ["q"] @sent)))))

(deftest sends-in-batches-and-stops-at-the-first-failure
  (let [sizes (atom [])]
    (with-redefs [fwd/send! (fn [_ batch] (swap! sizes conj (count batch)) {:ok? (= 1 (count @sizes)) :status 200})]
      (let [r (fwd/forward! {} {} (map #(boost (str "b" %)) (range 60)))]
        (is (= [25 25] @sizes) "the second batch failed, so the third was not tried")
        (is (= 25 (:sent r)))
        (is (= 35 (:queued r)))))))

(deftest the-queue-is-bounded-and-drops-the-oldest
  (with-redefs [fwd/send! (fn [_ _] {:ok? false :status 503})]
    (let [{:keys [state dropped]} (fwd/forward! {} {} (map #(boost (str "h" %)) (range (+ 10 fwd/max-pending))))]
      (is (= 10 dropped))
      (is (= fwd/max-pending (count (get state "forward-pending"))))
      (is (= "h10" (get (first (get state "forward-pending")) "payment_hash"))))))
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `clojure -M:test --focus boostbox.forward-test`
Expected: FAIL — namespace `boostbox.forward` not found.

- [ ] **Step 3: Implement** — create `src/boostbox/forward.clj`:

```clojure
(ns boostbox.forward
  "Send MSP's split payments to MSP-2.0's /api/boosts/ingest, where they feed the
   music chart. Since 2026-09-26 this bot is the chart's only live source; Helipad's
   webhook is retired. See MSP-2.0's
   docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md.

   Record building and queue bookkeeping are pure; `send!` is the one network call.
   MSP ignores a record it already holds, so every send here is safe to repeat."
  (:require [babashka.http-client :as http]
            [clojure.string :as str]
            [jsonista.core :as json]))

(def max-pending
  "Records kept for retry while MSP is unreachable. Past this the oldest are dropped
   and logged by the caller; a backfill run can resend them."
  500)

(def max-forwarded
  "Payment hashes remembered as sent, so a poll that re-reads its newest
   transactions does not send them again -- each send makes MSP rebuild a week."
  2000)

(def batch-size
  "Records per request: MSP writes one blob per record, inside one function timeout."
  25)

;; ~~~~~~~~~~~~~~~~~~~ Config ~~~~~~~~~~~~~~~~~~~

(defn- names [s]
  (into #{} (comp (map str/trim) (remove str/blank?) (map str/lower-case))
        (str/split (str s) #",")))

(defn env-config
  "Forwarding settings from `get-env`, a (fn [key default]). URL or token unset
   means forwarding is off -- the Boostr bot sets neither."
  [get-env]
  {:forward-url (some-> (get-env "BBN_FORWARD_URL" nil) str/trim not-empty)
   :forward-token (some-> (get-env "BBN_FORWARD_TOKEN" nil) str/trim not-empty)
   :forward-actions (let [named (names (get-env "BBN_FORWARD_ACTIONS" "boost,auto,stream"))]
                      (if (seq named) named #{"boost" "auto" "stream"}))})

(defn enabled?
  "Forwarding needs a URL, a token and a recipient filter. Without the filter the
   bot would send every split payment on the node -- other shows' boosts, with
   their listeners' messages -- to MSP."
  [{:keys [forward-url forward-token recipient-names]}]
  (boolean (and forward-url forward-token (seq recipient-names))))

;; ~~~~~~~~~~~~~~~~~~~ Records ~~~~~~~~~~~~~~~~~~~

(def ^:private boostbox->blip10
  "BoostBox's metadata names, as a boost link returns them, and the blip-10 names
   MSP's parser reads. `boost_link` is deliberately not here: in BoostBox it is a
   permalink, and MSP reads it as the song's own URL."
  {"feed_guid" "guid" "item_guid" "episode_guid" "feed_title" "podcast"
   "item_title" "episode" "recipient_name" "name" "position" "ts" "group" "uuid"})

(defn link-metadata->tlv
  "A boost link's metadata as a blip-10 map. Keys already in blip-10 form win over
   their BoostBox spelling; `boost_link` never survives."
  [m]
  (let [base (apply dissoc m "boost_link" (keys boostbox->blip10))]
    (reduce-kv (fn [acc from to]
                 (if (and (contains? m from) (not (contains? acc to)))
                   (assoc acc to (get m from))
                   acc))
               base boostbox->blip10)))

(def ^:private normalized->blip10
  {:action "action" :app-name "app_name" :app-version "app_version" :message "message"
   :sender-name "sender_name" :sender-id "sender_id" :recipient-name "name"
   :podcast "podcast" :episode "episode" :url "url" :feed-guid "guid"
   :item-guid "episode_guid" :remote-feed-guid "remote_feed_guid"
   :remote-item-guid "remote_item_guid" :group "uuid" :position "ts"
   :value-msat "value_msat" :value-msat-total "value_msat_total"})

(defn- boostagram->tlv
  "Last resort, when no original metadata survived: the normalized boostagram under
   blip-10 names."
  [b]
  (into {} (keep (fn [[k v]] (when-some [name (normalized->blip10 k)] (when (some? v) [name v])))) b))

(defn- tlv-string
  "The `tlv` MSP receives: what Helipad would have seen for this payment."
  [{:keys [tlv-json link-metadata wallet-boostagram boostagram]}]
  (cond tlv-json tlv-json
        link-metadata (json/write-value-as-string (link-metadata->tlv link-metadata))
        wallet-boostagram (json/write-value-as-string wallet-boostagram)
        :else (json/write-value-as-string (boostagram->tlv boostagram))))

(defn ->record
  "One payment in the shape of Helipad's BoostRecord, as MSP's ingest parses it.
   Everything descriptive rides in `tlv`; the outer fields are what only the wallet
   knows."
  [{:keys [payment-hash received-msat settled-at] :as boost}]
  {"source" "boostbox"
   "payment_hash" payment-hash
   "direction" "incoming"
   "time" settled-at
   "value_msat" received-msat
   "tlv" (tlv-string boost)})

;; ~~~~~~~~~~~~~~~~~~~ State ~~~~~~~~~~~~~~~~~~~

(defn forwarded? [state hash]
  (boolean (some #{hash} (get state "forwarded" []))))

(defn- mark-forwarded [state hashes]
  (let [hashes (vec hashes)
        kept (vec (remove (set hashes) (get state "forwarded" [])))]
    (assoc state "forwarded" (vec (take-last max-forwarded (into kept hashes))))))

;; ~~~~~~~~~~~~~~~~~~~ Sending ~~~~~~~~~~~~~~~~~~~

(defn send!
  "POST records to MSP's ingest as one JSON array. OK only on exactly 200: MSP
   answers 200 for a record it already holds, so OK means stored, now or before."
  [{:keys [forward-url forward-token]} records]
  (try
    (let [resp (http/post forward-url {:headers {"authorization" (str "Bearer " forward-token)
                                                 "content-type" "application/json"}
                                       :body (json/write-value-as-string (vec records))
                                       :timeout 30000
                                       :throw false})]
      {:ok? (= 200 (:status resp)) :status (:status resp)})
    (catch Exception e
      {:ok? false :error (ex-message e)})))

(defn forward!
  "Send the queue, then `boosts` (tx->boost! results) that are neither sent nor
   queued, oldest first, in batches. The first failed batch stops sending; it and
   everything after it stay queued, oldest dropped past `max-pending`.
   Returns {:state :sent :queued :dropped}."
  [ctx state boosts]
  (let [pending (vec (get state "forward-pending" []))
        queued (set (map #(get % "payment_hash") pending))
        fresh (->> boosts
                   (remove #(or (forwarded? state (:payment-hash %))
                                (contains? queued (:payment-hash %))))
                   (map ->record))]
    (loop [[batch & more] (partition-all batch-size (into pending fresh))
           sent []
           failed []]
      (cond
        (nil? batch)
        (let [dropped (max 0 (- (count failed) max-pending))]
          {:state (-> state
                      (mark-forwarded (map #(get % "payment_hash") sent))
                      (assoc "forward-pending" (vec (drop dropped failed))))
           :sent (count sent)
           :queued (- (count failed) dropped)
           :dropped dropped})

        (seq failed) (recur more sent (into failed batch))
        (:ok? (send! ctx batch)) (recur more (into sent batch) failed)
        :else (recur more sent (into failed batch))))))
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `clojure -M:test --focus boostbox.forward-test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/boostbox/forward.clj test/boostbox/forward_test.clj
git commit -m "feat(bot): build and queue MSP ingest records"
```

---

### Task B3: Forward from the poll loop

**Files:**
- Modify: `src/boostbox/nostrbot.clj` (`ns` requires; `config`; `poll-once!`; `-main`)
- Test: `test/boostbox/nostrbot_test.clj`

**Interfaces:**
- Consumes: everything `boostbox.forward` produces (Task B2).
- Produces: `config` merges `(fwd/env-config bb/get-env)`; the `::poll` log line gains `:forward-only`; new log events `::forwarded`, `::forward-pending-dropped`, `::forwarding-needs-recipient-names`.

- [ ] **Step 1: Write the failing tests** — in `nostrbot_test.clj` add `[boostbox.forward :as fwd]` to the `:require`, then:

```clojure
;; ~~~~~~~~~~~~~~~~~~~ Forwarding to MSP ~~~~~~~~~~~~~~~~~~~

(defn- stream [hash settled-at]
  {:payment-hash hash :settled-at settled-at :received-msat 1000
   :boostagram (bg/normalize {"action" "stream" "name" "MSP 2.0"
                              "guid" "c90e609a-df1e-596a-bd5e-57bcc8aad6cc"})})

(defn- fwd-ctx [a & {:as overrides}]
  (merge (ctx a
              :forward-url "https://msp.example/api/boosts/ingest"
              :forward-token "tok"
              :forward-actions #{"boost" "auto" "stream"}
              :recipient-names #{"msp 2.0"}
              :actions #{"boost" "auto"})
         overrides))

(defn- hashes [records] (mapv #(get % "payment_hash") records))

(deftest a-stream-is-forwarded-and-never-published
  (let [a (atom {"cursor" 50 "recent" []})
        sent (atom [])
        published (atom [])]
    (with-redefs [nwc/list-transactions! (fn [_ _] [::s1])
                  nwc/transaction->boost {::s1 (stream "s1" 100)}
                  fwd/send! (fn [_ batch] (swap! sent into batch) {:ok? true :status 200})
                  relay/publish-to-relays! (fn [_ e] (swap! published conj e) {:ok? true :results []})]
      (bot/poll-once! (fwd-ctx a) ::session)
      (is (empty? @published))
      (is (= ["s1"] (hashes @sent))))))

(deftest a-boost-is-forwarded-once-its-note-is-out
  (let [a (atom {"cursor" 50 "recent" []})
        sent (atom [])]
    (with-redefs [nwc/list-transactions! (fn [_ _] [::tx1])
                  nwc/transaction->boost {::tx1 (boost "h1" 100)}
                  bot/store-boost! (fn [_ _] {:id "01K9" :url "https://tardbox.com/boost/01K9"})
                  relay/publish-to-relays! (fn [_ _] {:ok? true :results []})
                  fwd/send! (fn [_ batch] (swap! sent into batch) {:ok? true :status 200})]
      (bot/poll-once! (fwd-ctx a) ::session)
      (is (= ["h1"] (hashes @sent)))
      (is (fwd/forwarded? @a "h1") "and the saved state says so"))))

(deftest a-boost-whose-note-failed-is-not-forwarded-yet
  (let [a (atom {"cursor" 50 "recent" []})
        sent (atom [])]
    (with-redefs [nwc/list-transactions! (fn [_ _] [::tx1])
                  nwc/transaction->boost {::tx1 (boost "h1" 100)}
                  bot/store-boost! (fn [_ _] {:id "01K9" :url "https://tardbox.com/boost/01K9"})
                  relay/publish-to-relays! (fn [_ _] {:ok? false :results []})
                  fwd/send! (fn [_ batch] (swap! sent into batch) {:ok? true :status 200})]
      (bot/poll-once! (fwd-ctx a) ::session)
      (is (empty? @sent)))))

(deftest msp-being-down-queues-without-holding-the-cursor
  (let [a (atom {"cursor" 50 "recent" []})]
    (with-redefs [nwc/list-transactions! (fn [_ _] [::tx1])
                  nwc/transaction->boost {::tx1 (boost "h1" 100)}
                  bot/store-boost! (fn [_ _] {:id "01K9" :url "https://tardbox.com/boost/01K9"})
                  relay/publish-to-relays! (fn [_ _] {:ok? true :results []})
                  fwd/send! (fn [_ _] {:ok? false :status 503})]
      (bot/poll-once! (fwd-ctx a) ::session)
      (is (= 100 (get @a "cursor")) "the note went out, so the cursor moves on")
      (is (= ["h1"] (hashes (get @a "forward-pending")))))))

(deftest nothing-is-forwarded-without-a-recipient-filter
  (let [a (atom {"cursor" 50 "recent" []})
        sent (atom [])]
    (with-redefs [nwc/list-transactions! (fn [_ _] [::s1])
                  nwc/transaction->boost {::s1 (stream "s1" 100)}
                  fwd/send! (fn [_ batch] (swap! sent into batch) {:ok? true :status 200})]
      (bot/poll-once! (fwd-ctx a :recipient-names #{}) ::session)
      (is (empty? @sent)))))
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `clojure -M:test --focus boostbox.nostrbot-test`
Expected: FAIL — nothing is sent (`fwd/send!` is never called).

- [ ] **Step 3: Implement** — in `nostrbot.clj`:

Add `[boostbox.forward :as fwd]` to the `ns` `:require`.

At the end of `config`, wrap the returned map: change the body's final map literal `{:bb-cfg bb-cfg … }` to `(merge {:bb-cfg bb-cfg … } (fwd/env-config bb/get-env))`, and add a comment above the `merge`: `;; BBN_FORWARD_* -- see boostbox.forward; only msp-bot sets them`.

Add above `poll-once!`:

```clojure
(defn- forward-poll!
  "Send this poll's forwardable payments -- and anything still queued -- to MSP.
   A publishable boost goes once its note is out or it was deliberately skipped,
   so the chart never holds a boost the bot may still fail on; a stream, which is
   never published, goes as soon as it is read."
  [ctx state results publishable?]
  (let [idx (seen-index state)
        settled? (fn [r] (let [e (get idx (:payment-hash r))]
                           (or (get e "event_id") (get e "skipped"))))
        ready (filter #(and (:boostagram %)
                            (bg/boost? (:boostagram %) (:forward-actions ctx))
                            (or (not (publishable? %)) (settled? %)))
                      results)
        {:keys [state sent queued dropped]} (fwd/forward! ctx state ready)]
    (when (pos? dropped)
      (u/log ::forward-pending-dropped :dropped dropped :limit fwd/max-pending))
    (when (or (pos? sent) (pos? queued) (pos? dropped))
      (u/log ::forwarded :sent sent :queued queued)
      (save-state! (:state-io ctx) state))
    state))
```

In `poll-once!`, replace the three bindings `txs`, `results`, `boosts` with:

```clojure
        forwarding? (fwd/enabled? ctx)
        ;; a stream MSP wants must be read as a boostagram, not skipped as
        ;; :not-a-boost; what is *published* is still decided by :actions alone
        read-ctx (cond-> ctx
                   forwarding? (update :actions (fnil into #{"boost"}) (:forward-actions ctx)))
        txs (fetch-transactions! session cursor)
        results (mapv #(tx->boost! read-ctx %) txs)
        publishable? #(and (:boostagram %) (bg/boost? (:boostagram %) (:actions ctx #{"boost"})))
        boosts (->> results (filter publishable?) (sort-by #(or (:settled-at %) 0)))
        forward-only (count (remove publishable? (filter :boostagram results)))
```

change the `::poll` log to add `:forward-only forward-only` after `:boosts (count boosts)`, and wrap the existing `(loop [state state [b & more] boosts] …)` so the function ends:

```clojure
    (let [state (loop [state state
                       [b & more] boosts]
                  ...existing loop body, unchanged...)]
      (if forwarding?
        (forward-poll! ctx state results publishable?)
        state))))
```

In `-main`, after the `::ephemeral-state-permitted` `when`, add:

```clojure
    ;; a URL without a recipient filter would forward every split on the node
    (when (and (:forward-url cfg) (not (fwd/enabled? cfg)))
      (u/log ::forwarding-needs-recipient-names
             :note "BBN_FORWARD_URL is set but forwarding is off: it also needs BBN_FORWARD_TOKEN and BBN_RECIPIENT_NAMES."))
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `clojure -M:test --focus boostbox.nostrbot-test --focus boostbox.forward-test`
Expected: PASS, the existing poll tests included (their ctx sets no forward URL, so forwarding is off).

- [ ] **Step 5: Commit**

```bash
git add src/boostbox/nostrbot.clj test/boostbox/nostrbot_test.clj
git commit -m "feat(bot): forward MSP's boosts and streams from each poll"
```

---

### Task B4: The one-off backfill

**Files:**
- Create: `src/boostbox/forwardbackfill.clj`
- Create: `test/boostbox/forwardbackfill_test.clj`
- Create: `scripts/msp-forward-backfill.sh` (mode 755)

**Interfaces:**
- Consumes: `bot/fetch-transactions!`, `bot/tx->boost!`, `fwd/env-config`, `fwd/enabled?`, `fwd/->record`, `fwd/send!`, `fwd/batch-size`, `nwc/parse-uri`, `nwc/open!`, `nwc/close!`.
- Produces: `(backfill! ctx session from) → {:read :forwardable :sent :failed}`; entry point `java -cp boostbox.jar boostbox.forwardbackfill <from-unix-seconds>`.

- [ ] **Step 1: Write the failing tests** — create `test/boostbox/forwardbackfill_test.clj`:

```clojure
(ns boostbox.forwardbackfill-test
  (:require [clojure.test :refer [deftest is]]
            [boostbox.boostagram :as bg]
            [boostbox.forward :as fwd]
            [boostbox.forwardbackfill :as bf]
            [boostbox.nostrbot :as bot]
            [boostbox.relay :as relay]))

(defn- result [hash action]
  {:payment-hash hash :settled-at 1790000000 :received-msat 1000
   :boostagram (bg/normalize {"action" action "name" "MSP 2.0"})})

(def ^:private ctx {:forward-actions #{"boost" "auto" "stream"} :recipient-names #{"msp 2.0"}})

(deftest backfill-sends-boosts-and-streams-in-batches-and-publishes-nothing
  (let [batches (atom [])
        txs (vec (range 30))
        results (into {} (map (fn [i] [i (result (str "h" i) (if (even? i) "stream" "auto"))]) txs))]
    (with-redefs [bot/fetch-transactions! (fn [_ _] txs)
                  bot/tx->boost! (fn [_ tx] (results tx))
                  relay/publish-to-relays! (fn [& _] (throw (ex-info "the backfill must not publish" {})))
                  fwd/send! (fn [_ batch] (swap! batches conj (count batch)) {:ok? true :status 200})]
      (is (= {:read 30 :forwardable 30 :sent 30 :failed 0} (bf/backfill! ctx ::session 1769721533)))
      (is (= [25 5] @batches)))))

(deftest backfill-sends-only-what-is-forwardable
  (with-redefs [bot/fetch-transactions! (fn [_ _] [1 2 3])
                bot/tx->boost! (fn [_ tx] (case tx
                                            1 (result "a" "boost")
                                            2 {:skip :other-recipient :payment-hash "b"}
                                            3 (result "c" "invoice")))
                fwd/send! (fn [_ batch] {:ok? (= ["a"] (mapv #(get % "payment_hash") batch)) :status 200})]
    (is (= {:read 3 :forwardable 1 :sent 1 :failed 0} (bf/backfill! ctx ::session 0)))))

(deftest backfill-counts-a-failed-batch-and-carries-on
  (let [calls (atom 0)]
    (with-redefs [bot/fetch-transactions! (fn [_ _] (vec (range 30)))
                  bot/tx->boost! (fn [_ tx] (result (str "h" tx) "boost"))
                  fwd/send! (fn [_ _] {:ok? (= 2 (swap! calls inc)) :status 200})]
      (is (= {:read 30 :forwardable 30 :sent 5 :failed 25} (bf/backfill! ctx ::session 0))))))
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `clojure -M:test --focus boostbox.forwardbackfill-test`
Expected: FAIL — namespace `boostbox.forwardbackfill` not found.

- [ ] **Step 3: Implement** — create `src/boostbox/forwardbackfill.clj`:

```clojure
(ns boostbox.forwardbackfill
  "One-off: send MSP's split payments since a date to MSP-2.0's ingest. Publishes
   nothing to Nostr and never reads or writes the deployed bot's state; MSP ignores
   what it already holds, so a re-run is always safe. See
   scripts/msp-forward-backfill.sh."
  (:require [boostbox.boostagram :as bg]
            [boostbox.boostbox :as bb]
            [boostbox.forward :as fwd]
            [boostbox.nostrbot :as bot]
            [boostbox.nwc :as nwc]
            [clojure.string :as str]
            [com.brunobonacci.mulog :as u])
  (:gen-class))

(defn backfill!
  "Read every transaction since `from` (unix seconds), keep MSP's forwardable
   payments, and send them in batches. A failed batch is counted and the rest
   still go. Returns {:read :forwardable :sent :failed}."
  [ctx session from]
  (let [txs (bot/fetch-transactions! session from)
        ;; nothing is published, so reading is decided by what MSP wants alone
        read-ctx (assoc ctx :actions (:forward-actions ctx))
        boosts (->> txs
                    (map #(bot/tx->boost! read-ctx %))
                    (filter #(and (:boostagram %)
                                  (bg/boost? (:boostagram %) (:forward-actions ctx)))))
        outcomes (mapv (fn [batch] [(count batch) (:ok? (fwd/send! ctx batch))])
                       (partition-all fwd/batch-size (map fwd/->record boosts)))]
    {:read (count txs)
     :forwardable (count boosts)
     :sent (reduce + 0 (map first (filter second outcomes)))
     :failed (reduce + 0 (map first (remove second outcomes)))}))

(defn -main
  "java -cp boostbox.jar boostbox.forwardbackfill <from-unix-seconds>
   Reads BBN_NWC_URI, BBN_FORWARD_URL, BBN_FORWARD_TOKEN, BBN_RECIPIENT_NAMES and
   BBN_FORWARD_ACTIONS from the environment."
  [& [from]]
  (let [stop (u/start-publisher! {:type :console})
        cfg (merge (fwd/env-config bb/get-env)
                   {:nwc (nwc/parse-uri (bb/get-env "BBN_NWC_URI"))
                    :recipient-names (into #{} (comp (map str/trim) (remove str/blank?) (map str/lower-case))
                                           (str/split (bb/get-env "BBN_RECIPIENT_NAMES" "") #","))
                    :boost-link-origins nil})]
    (when-not (fwd/enabled? cfg)
      (binding [*out* *err*]
        (println "BBN_FORWARD_URL, BBN_FORWARD_TOKEN and BBN_RECIPIENT_NAMES are all required"))
      (System/exit 2))
    (let [session (nwc/open! (:nwc cfg))]
      (try
        (println (backfill! cfg session (Long/parseLong (str from))))
        (finally
          (nwc/close! session)
          (Thread/sleep 250)
          (stop))))
    (System/exit 0)))
```

Create `scripts/msp-forward-backfill.sh` (tabs for indentation, like `bot-local.sh`), then `chmod 755 scripts/msp-forward-backfill.sh`:

```bash
#!/usr/bin/env bash
# One-off: send MSP 2.0's split payments since FROM to MSP-2.0's chart ingest.
# Publishes nothing to Nostr and never touches the deployed bot's state.
# Re-running it is always safe: MSP ignores a record it already holds.
#
#   clojure -T:build uber              # once, builds target/boostbox.jar
#   scripts/msp-forward-backfill.sh    # FROM defaults to the chart's cutover
#
# It prompts for the NWC connection string ("MSP nostr info" in Alby Hub) and the
# MSP ingest token, both with echo off, so neither lands in shell history or `ps`.
# Reading the wallet history since the cutover takes about 17 minutes.
set -euo pipefail
cd "$(dirname "$0")/.."

JAR="${JAR:-target/boostbox.jar}"
FROM="${FROM:-1769721533}" # 2026-01-29T21:18:53Z, BOOSTBOX_CUTOVER in MSP-2.0

[ -f "$JAR" ] || {
	echo "missing $JAR -- run:  clojure -T:build uber" >&2
	exit 1
}
[ -t 0 ] || {
	echo "stdin is not a terminal -- run this from a normal terminal" >&2
	exit 1
}

printf 'Paste the NWC connection string (input hidden): '
read -rs BBN_NWC_URI || true
printf '\nPaste the MSP ingest token (input hidden): '
read -rs BBN_FORWARD_TOKEN || true
printf '\n\n'
[ -n "$BBN_NWC_URI" ] && [ -n "$BBN_FORWARD_TOKEN" ] || {
	echo "both are required" >&2
	exit 1
}

export BBN_NWC_URI BBN_FORWARD_TOKEN
export BBN_FORWARD_URL="${BBN_FORWARD_URL:-https://musicsideproject.com/api/boosts/ingest}"
export BBN_RECIPIENT_NAMES="${BBN_RECIPIENT_NAMES:-MSP 2.0}"
export BBN_FORWARD_ACTIONS="${BBN_FORWARD_ACTIONS:-boost,auto,stream}"

echo "sending MSP split payments since unix time $FROM to $BBN_FORWARD_URL"
exec java -cp "$JAR" boostbox.forwardbackfill "$FROM"
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `clojure -M:test --focus boostbox.forwardbackfill-test && bash -n scripts/msp-forward-backfill.sh`
Expected: PASS, and no shell syntax error.

- [ ] **Step 5: Commit**

```bash
git add src/boostbox/forwardbackfill.clj test/boostbox/forwardbackfill_test.clj scripts/msp-forward-backfill.sh
git commit -m "feat(scripts): backfill MSP's chart from the wallet history"
```

---

### Task B5: Document, verify, open the PR

**Files:**
- Modify: `CLAUDE.md` (the "MSP bot" bullet under Deployment; the operator-scripts list; the Source Layout list)
- Modify: `README.md` (bot environment table)

- [ ] **Step 1: Update the docs.**

In `CLAUDE.md` Source Layout (boost bot list), add:

```markdown
- `src/boostbox/forward.clj` — MSP chart forwarding: Helipad-shaped ingest records, the `forward-pending` retry queue, the forwarded-hash set. Pure except `send!`
- `src/boostbox/forwardbackfill.clj` — `(:gen-class)` one-off: sends MSP's split payments since a date, publishing nothing
```

In the operator-scripts list, add:

```markdown
- `scripts/msp-forward-backfill.sh` — send MSP 2.0's split payments since the chart's cutover (2026-01-29T21:18:53Z) to MSP-2.0's ingest. Prompts for the NWC string and the ingest token with echo off; publishes nothing to Nostr; safe to re-run
```

Append to the "MSP bot" deployment bullet:

```markdown
**It is also the MSP chart's only live source** (since 2026-09-26; Helipad's webhook is retired): with `BBN_FORWARD_URL=https://musicsideproject.com/api/boosts/ingest` and `BBN_FORWARD_TOKEN` (MSP-2.0's `MSP_BOT_INGEST_TOKEN`) it POSTs every MSP split payment — boosts, auto-boosts **and streams**, `BBN_FORWARD_ACTIONS` — to MSP, while still publishing only `BBN_ACTIONS` to Nostr. It sends the payer's TLV byte for byte (`:tlv-json`), because `bg/normalize` folds `boost_link` into `:url` and MSP's song resolver keys on `boost_link`; a boost link's metadata goes under blip-10 names with the permalink left out. A publishable boost is forwarded once its note is out; a failed send waits in `forward-pending` (500 max) and is retried every poll, never holding the cursor. Forwarding refuses to start without `BBN_RECIPIENT_NAMES`, or it would ship every split on the node to MSP.
```

In `README.md`'s bot variable table, after the `BBN_RECIPIENT_NAMES` row, add:

```markdown
| `BBN_FORWARD_URL` | No | *(unset)* | MSP-2.0's `/api/boosts/ingest`. With a token and `BBN_RECIPIENT_NAMES`, every matching split payment is forwarded to MSP's chart. |
| `BBN_FORWARD_TOKEN` | No | *(unset)* | Bearer token for that ingest; equals MSP-2.0's `MSP_BOT_INGEST_TOKEN`. |
| `BBN_FORWARD_ACTIONS` | No | `boost,auto,stream` | Which blip-10 actions are forwarded. Streams are forwarded but never published. |
```

- [ ] **Step 2: Run every check**

Run:

```bash
clojure -M:test
clojure -Sdeps '{:deps {dev.weavejester/cljfmt {:mvn/version "0.13.0"}}}' -M -m cljfmt.main check \
  src/boostbox/forward.clj src/boostbox/forwardbackfill.clj src/boostbox/nostrbot.clj src/boostbox/nwc.clj \
  test/boostbox/forward_test.clj test/boostbox/forwardbackfill_test.clj test/boostbox/nostrbot_test.clj test/boostbox/nwc_test.clj
clojure -T:build uber && jar tf target/boostbox.jar | grep -c 'boostbox/forwardbackfill'
```

Expected: 0 failures (report the test and assertion counts); cljfmt reports nothing (fix with `fix` in place of `check`); the jar contains the backfill class (count ≥ 1).

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md README.md
git commit -m "docs: msp-bot forwards MSP's split payments to the chart"
git push -u origin feat/msp-forward
gh pr create --base main --title "feat(bot): forward MSP's split payments to MSP-2.0's chart" --body-file <(cat <<'EOF'
Implements Part B of MSP-2.0's docs/superpowers/plans/2026-09-26-msp-bot-boost-ingest.md (spec: docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md).

- `boostbox.forward`: Helipad-shaped records (TLV byte for byte; no permalink in `boost_link`), a bounded retry queue, a forwarded-hash set
- The poll forwards boosts once their note is out and streams as soon as they are read; a failed send never holds the cursor
- Off unless `BBN_FORWARD_URL`, `BBN_FORWARD_TOKEN` and `BBN_RECIPIENT_NAMES` are all set — the Boostr bot is unchanged
- `scripts/msp-forward-backfill.sh` sends the history since the cutover, publishing nothing

Merge only after MSP-2.0's Part A is deployed and `MSP_BOT_INGEST_TOKEN` is set.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Nkgue6i8tacQG81M4sfC6C
EOF
)
```

---

# Part C — Rollout (Chad and the session, in this order)

1. **Merge MSP-2.0 Part A.** Wait for the production deploy. `curl -s -o /dev/null -w "%{http_code}" https://musicsideproject.com/api/boosts/chart` must still answer 401.
2. **Migrate the weekly files.** Chad runs, from `~/Vibe/MSP-2.0` (the env file is deleted at the end). Pull **Development**: that is where a working `BLOB_READ_WRITE_TOKEN` came from on 2026-09-26, and it reaches the same store. The script stops with a clear message if `MSP_ADMIN_KEY` is missing from that environment; then add the key to the Development environment in Vercel, or export it in the shell first.
   ```bash
   S=$(mktemp -d); vercel env pull "$S/env" --environment=development --yes >/dev/null 2>&1; ENVFILE="$S/env" node tools/migrate-derived-to-namespace.mjs; rm -rf "$S"
   ```
   Run it **without** `--delete-old` here: this run only rebuilds each week under the namespace and compares counts. Every week before `2026-W05` must match. The comparison means something only for those weeks: an old file holds every record on the node, while a new file after the cutover holds only msp-bot's (none until the step 6 backfill), so later weeks differ by design. The old files are deleted in step 8, after verification.
3. **Create the shared token.** `openssl rand -hex 32`. Set it as `MSP_BOT_INGEST_TOKEN` in Vercel (Production) and redeploy MSP; keep it for step 5.
4. **Merge boostbox Part B.** `msp-bot` and `boostbox` redeploy on the watch paths.
5. **Configure `msp-bot`** in the Railway dashboard: `BBN_FORWARD_URL=https://musicsideproject.com/api/boosts/ingest`, `BBN_FORWARD_TOKEN=<the token from step 3>`. Its next poll logs `::forwarded` when a payment arrives.
6. **Backfill.** `clojure -T:build uber && scripts/msp-forward-backfill.sh` from `~/Vibe/boostbox`; paste the "MSP nostr info" NWC string and the token. Expect about 339 boosts plus the streams, `:failed 0`.
7. **Verify** (spec section 8): re-run the record-by-record match (0 bot-only, 0 chart-only after the cutover); admin chart all-time **344** boosts; MSP-split stream **records** — the admin coverage view's `msp.streamRecords`, not the chart's collapsed `totalStreams` — at least **83**: the 1 Helipad stream before the cutover plus at least the 82 records Helipad held since; the 36 song-guid boosts keep titles; StableKraft / Castamatic / BoostMeBitch songs appear. Then take five LNURL boosts from v4vmusic, Castamatic and StableKraft whose listener message names the song and confirm their `trackSource` is `message` (the bot forwards a boost link's `position` under its own name, not as `ts`, so these records never land on `timesplit`). The coverage view reports counts only (`msp.bySource`, `msp.byApp`), so read each record's `trackSource` from its week file `boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json`, found by `paymentHash`.
8. **Delete the old public weekly files**, only after step 7 passes. Run the step 2 line again with `--delete-old` appended to the `node` command. Then an old `boosts/derived/<week>.json` URL must answer 404.
9. **Retire Helipad's webhook.** Turn off the chart trigger in Helipad. Removing `HELIPAD_WEBHOOK_TOKEN` from Vercel is optional and can wait.
