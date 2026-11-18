# Boost capture and the music chart

Read before changing boost ingest, the raw/derived blob store, `tools/import-helipad.mjs`, the coverage report or the `/charts` chart.

Every feed MSP generates carries a 1% `MSP 2.0` split (`MSP_SUPPORT_RECIPIENT`, `src/types/feed.ts`). This subsystem stores those payments and builds a private chart of what listeners streamed and boosted. It is not a revenue dashboard.

## Sources

- **msp-bot (boostbox) is the only live source.** It reads the node's Alby Hub wallet over NWC and POSTs every MSP split payment (boosts, auto-boosts, streams) to `/api/boosts/ingest` with `source: "boostbox"`, a `payment_hash` instead of `index`, and `MSP_BOT_INGEST_TOKEN`. Helipad's trigger is off; its history comes only from `tools/import-helipad.mjs`. Design: `docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md`.
- Each token writes only its own source's records. The bot token may send neither the `{ week, records }` envelope (it would rewrite a week without Helipad's records) nor a record that is not the MSP split.
- **`BOOSTBOX_CUTOVER`** (`boostRecord.ts`, 2026-01-29T21:18:53Z): `selectSource` (`boostStore.ts`) keeps Helipad's records before it and the bot's from it on, so each payment counts once without pairing. Helipad raw records after it stay in raw, never counted. A record with no `source` is Helipad's. Dedup key: `recordKey` (`h:<index>` / `ph:<payment_hash>`).
- For bot records naming a remote item, ingest fills `remote_episode` / `remote_podcast` from Podcast Index before the raw write (`enrichWithRemoteTitles`), as Helipad did itself.

## Env vars

- `MSP_BOOST_NAMESPACE` — one path segment (16-128 chars of `[A-Za-z0-9_-]`) that raw and derived blobs live under. Not decorative: Helipad's `index` is a small incrementing integer, so without it the raw tree (listener messages, sender names) is enumerable if the store subdomain leaks. Rotating it orphans every stored blob; the importer can re-post Helipad's history only.
- `HELIPAD_WEBHOOK_TOKEN`, `MSP_BOT_INGEST_TOKEN` — ingest bearer tokens, one per source (`timingSafeEqualString`). Ingest answers 404 when neither is set or the namespace is missing or malformed.
- `CRON_SECRET` — Vercel Cron sends it as `Authorization: Bearer`. `/api/boosts/rebuild` refuses the cron path when it is unset, never open, because it rewrites stored data.
- `MSP_LISTENER_HASH_KEY` — HMAC key for `listenerKey` (`hashListener`, app + sender, 64 bits). Separate from the email/session keys so each rotates alone; rotating it only breaks play grouping across the boundary. Optional: unset, plays collapse on app and track alone, which can only undercount.
- `MSP_CHART_PUBKEYS` — comma-separated npubs or hex that may read the chart and nothing else (`parseChartAuthHeader`): how to share it without admin rights, which include deleting any hosted feed. Needs a redeploy.

## Endpoints and modules

- `api/boosts/ingest.ts` — POST, bearer, `boost-ingest:` 600/hr, at most 500 records (`MAX_BATCH`), `maxDuration` 60 s. A record or array writes raw, then rebuilds each touched week from raw. `{ week, records }` (importer only) writes raw, then the week whole. Success is exactly 200.
- `api/boosts/rebuild.ts` — GET. Rebuilds the current and previous ISO week from raw. Callers: Vercel Cron (daily 05:00 UTC, `vercel.json`), `MSP_ADMIN_KEY` or a NIP-98 admin; `?week=` repairs one week, admin only. `maxDuration` 60 s.
- `api/boosts/coverage.ts` — GET, admin. Aggregates over derived: which ladder rung resolved records, by action, app and week, top 10s, sats totals. Never a raw record. Its `everything` view covers the whole node and deliberately has no chart. UI: `/admin` (`BoostCoverage.tsx`). Read it before designing around a chart period: named records are few.
- `api/boosts/chart.ts` — GET, the chart behind `/charts` (`src/pages/ChartsPage.tsx`, `src/components/charts/TrendGraphs.tsx`). `boost-chart:` 120/hr.
- `api/_utils/boostRecord.ts` (parsing, ladder, `toDerived`, `isMspSplit`), `boostStore.ts` (paths, raw and week writes), `boostChart.ts` (rows, merging, artists, "New").

## Privacy boundary: `toDerived()`

Raw records are stored verbatim, listener message, sender name and id included, because the song title is often only in the message. Nothing serves a raw record. `toDerived()` is the only boundary: `DerivedBoost` has no listener field, and a test in `boostRecord.test.ts` serializes it and searches for them. Keep that test honest when adding a field.

## Storage

- Raw: `boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index>.json` (Helipad) or `…/incoming-ph-<payment_hash>.json` (msp-bot). Written once with `allowOverwrite: false`; the path is the dedup key.
- Derived: `boosts/derived/<MSP_BOOST_NAMESPACE>/<isoYear>-W<week>.json`. PII-free but carries per-boost amounts, so it is behind the namespace too. The chart groups by UTC month and all time at read time.
- The derived write uses every record in the request, duplicates included, so re-running the importer repairs a lost derived write and re-derives history through an improved `resolveTrack()`.

## Never read-modify-write a Vercel Blob

- Public blobs are served through a CDN keyed on **pathname** with a **60 s floor** (`cacheControlMaxAge: 0` is clamped to 60). A cache-busting query string is ignored, and `cache: 'no-store'` does nothing in Node's fetch.
- So a read of a recently written blob is stale and each merge rewrites the file smaller, erratically. A test that writes the same content repeatedly cannot detect it.

The design is immune rather than careful:
- **Raw is immutable** and never re-read during a write, so a cached read is always correct. Raw is the source of truth; every derived file rebuilds from it.
- **A derived week is written whole** (`replaceDerivedWeek`); no previous version is read. The envelope **refuses** a record outside its week rather than dropping it.
- **A live POST rebuilds its own week from raw** (`rebuildWeekFromRaw`) and folds in its own records, because `list()` may not yet show a blob written moments earlier.
- **The importer's week write reads the week's bot records first** (`readStoredBoostboxRecords`), or a re-run would drop them.
- **The daily cron is the backstop**: current and previous ISO week only (a boost just after Monday midnight lands in the new week while the old one can take a late write). Older weeks change only via the importer or `?week=`.

## Track resolution ladder

Best rung first, recorded as `trackSource`: `remote-guid` (`podcast:remoteItem` pair) → `remote-title` → `boost-link` (an app's own song URL) → `timesplit` → `message` → `none`.
- **`timesplit` returns no `trackKey`.** A playback offset is a pointer to resolve later against `valueTimeSplit`s; keying on it makes two boosts seconds apart look like different tracks.
- **A message-scraped title enriches higher rungs.** The rung picks the key; the title comes from the best source (`boost-link` has no name of its own).
- `decodeEntities()` runs on every title and artist; `&amp;` is decoded last, or `&amp;lt;` decodes twice into `<`.

`isMspSplit()` is the chart's whole scope: TLV `name`, trimmed and case-folded, equals `MSP_SUPPORT_RECIPIENT_NAME`. Only the TLV `name` carries it, and Helipad trigger filters cannot match it, so the check lives on MSP's side. The name is duplicated from `src/types/feed.ts` (functions cannot import `src/`); change both together.

## The chart

**Private.** `/api/boosts/chart` opens to `MSP_ADMIN_KEY`, a NIP-98 admin, or a key on `MSP_CHART_PUBKEYS`. It sets `Cache-Control: private, no-store` before the auth check, so a 401 is not cached either (a CDN copy of an authenticated response is served to anyone). `/charts` sits inside `NostrProvider` like `/admin` and shows nothing until an allowed key signs in. **To make it public, change the gate and the cache header together**, with a short shared cache (it was `s-maxage=300`; an hour hides the live rebuild).

What may leave the endpoint (each rule tested in `chart.test.ts`):
- **MSP splits only.**
- **Counts, never amounts.** No sats field: earnings of artists who never agreed to publication are not MSP's to give away.
- **Named tracks only.** Untitled rows are left out of lists but counted in totals.
- **Listeners as a number, never keys.** A `listenerKey` is a stable pseudonym; a list of them is a list of people.

Grouping:
- **Streams and boosts are separate lists.** Streams (`isPlayRecord`) carry a `remoteItem`, so they are music-only; boosts also land on podcasts and test feeds, which topped a combined score.
- **`collapseToPlays()`** folds one listener's run on a track (gap under `DEFAULT_PLAY_GAP_MS`, 20 min) into one play. Streaming sats fire about once a minute, so raw stream records rank by track length.
- **"Boosts" includes auto-boosts** (`isBoostRecord`), and the page blurb says so; manual boosts alone are too thin. If the grouping changes, change the wording.
- **A boost link is not a song identity**: v4vmusic reuses one link across songs. `chartKey` keys a `boost-link` record by link **and** normalized title (in `topTracks` and `collapseToPlays`); an untitled one stays in its own row. Read-time grouping, no rebuild needed.
- **`mergeAliases`** joins rows with the same normalized title when one artist is a prefix of the other or equals the other's last `" - "` part ("Album", "Artist", "Album - Artist"). No bare suffix match ("Fred" ≠ "Right Said Fred"); "Album" alone never joins "Artist" alone. Merged rows carry `mergedFrom`, shown on `/charts` so a wrong merge is visible.
- **Artists are read from the label, never guessed** (`topArtists`): the part after the last `" - "`, or the whole label. An album-only label joins an artist only when some row names that album with exactly one artist (`albumArtists`); "Singles" with two artists maps to neither. Joins go in `mergedFrom`.
- **A listener is one sender in one app**; no sender means `unattributed`, shown as "N+ listeners".
- **"New" is dated by all time** (`buildIdentity`): a month row takes the earliest all-time date of any of its keys, and months group artists with the all-time album map. Nothing is new in the first month with data. `isNew` is sent only when true, never on `allTime`.
- **Trends** (inline SVG, no library): `trend.months` runs from the first month with data to this month with no gaps (a quiet month is a zero). Only all-time rows carry `trend`. This month is fainter and labelled "so far". `trend.completeFrom` is the month after the cutover month; earlier months are Helipad's, which missed LNURL boosts, and the page says so. Every graph value is also in text.
- **Lists start folded** (`ChartList`, native `<details>`) with a count in the heading. Not a cap: `chart.ts` cuts no row.
- The page says the chart is a sample: MSP sees a payment only when its own split was paid.

## Helipad facts (for the importer)

From `Podcastindex-org/helipad` source, not its README:
- Webhooks are **triggers** sending `Authorization: Bearer <token>`; no HMAC or signature.
- **Success is HTTP exactly 200**, and **Helipad never retries**. Redirects cap at 5.
- **`tlv` is a JSON string** written by the boosting app; every field is optional and a parse failure must not lose the boost.
- **`action` exists twice**: a number (`ActionType`) in the body, a word in the TLV. `parseBoostPayload` prefers the number.
- **`ActionType` is `Unknown=0, Stream=1, Boost=2, Invalid=3, Auto=4, Invoice=5`** (the README lists three).
- **The trigger Test button sends `index` 99999.** `isHelipadTestBoost()` drops it and still answers 200; storing it would shadow a real boost with that index.
- **Boosts and streams are separate lists**: walk `/api/v1/boosts` and `/api/v1/streams` both, or the play signal is missed. They share one index space, so indexes never collide.
- **`stay_logged_in` on `/api/v1/login` is a string**; `true` gets a 422.
- **Never backfill from `/csv`**: it lacks `tlv`, `url`, `guid` and recipient `name`, so it cannot join a feed or find the MSP split.

## Tooling

- `tools/import-helipad.mjs` is the backfill and repair tool and the only path to Helipad. It posts one whole ISO week per request; a week over `--batch` (max 500) is skipped, never split, since a second post would overwrite the first. **Re-running it is always safe.**
- `tools/migrate-derived-to-namespace.mjs` is a finished one-off.
- **Committed tooling lives in `tools/`, not `scripts/`**: `.gitignore` ignores `scripts/`, so a script there is never committed and is invisible to CI, Vercel and the Desktop App fork.
