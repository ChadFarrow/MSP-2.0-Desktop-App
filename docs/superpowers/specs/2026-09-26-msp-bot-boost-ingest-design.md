# msp-bot replaces the Helipad webhook as the chart's source

Status: approved design, 2026-09-26. Spans two repos: `ChadFarrow/MSP-2.0` (this one) and
`ChadFarrow/boostbox` (the `msp-bot` service).

## Why

The MSP chart is built only from Helipad. `msp-bot` (boostbox, live since 2026-09-26)
reads the same node's Alby Hub wallet over NWC, and sees every MSP 2.0 split payment.

Measured on 2026-09-26, matching every record one to one (same app, same total amount,
settle times 0–1 s apart):

| | Count |
|---|---|
| Chart boost/auto records in the bot's window (from 2026-01-29) | 252 |
| …also in the bot's data | 252 (all) |
| Only in the chart | 0 |
| Only in the bot's data | **87** (26% of 339) |

Misses by app: StableKraft 13/13, Castamatic 9/9, candr.space 2/2, BoostMeBitch 25/34,
OnlyBoosts 2/3, CurioCaster 2/6, v4vmusic 30/216, PodcastGuru 4/30, V4V Player 0/25.
Whole apps missing points to the payment path: these apps pay the lightning address
(LNURL), whose metadata travels only as a boost link in the invoice description. Helipad
does not follow it; the bot does. Some partial misses may also be webhooks Helipad never
retried. The bot has neither weakness: it follows boost links, and after downtime it
reads the missed payments back from the wallet.

For boosts the bot is a strict superset. Helipad supplies only two things the bot does
not send today, and both are replaceable:

- **Streams** — 83 MSP-split stream records (82 since 2026-01-29), about 10 a month, the
  whole "Most streamed" list. The bot already sees these payments and skips them.
- **Titles for song-guid boosts** — 36 boosts resolve by `remote_feed_guid` /
  `remote_item_guid`, all titled. Those titles come from Helipad's own lookup
  (`remote_episode`, `remote_podcast`) or from the listener's message. The
  `remote-title` rung (Helipad titles with no guid) was used 0 times.

**Goal:** a private chart of top tracks and artists fed by one live source, the bot,
counting every MSP split payment, with the chart's song names.

**Not goals:** publishing anything (the chart is admin-only, #140); changing what the bot
posts to Nostr; deleting Helipad's stored history.

## 1. Data flow and identity

```
Alby Hub wallet ──NWC──▶ msp-bot ──┬──▶ Nostr: boosts only (unchanged)
                                   └──▶ POST /api/boosts/ingest: boosts and streams
Helipad on the node ──webhook─────────▶ (turned off at the end of the rollout)
```

- `msp-bot` sends one record per MSP split payment — boost, auto and stream — to the
  existing `/api/boosts/ingest`, in the shape Helipad's `BoostRecord` uses, so
  `parseBoostPayload` and `resolveTrack` apply unchanged: `direction: "incoming"`, `time`
  (the wallet's `settled_at`), `value_msat` (received), `value_msat_total` (when known),
  `app`, `message`, `sender`, `podcast`, `episode`, and `tlv` as a **JSON string**. No
  outer `action`: the TLV's word decides, as it already does when Helipad's number is
  absent.
- In place of Helipad's `index` the record carries `source: "boostbox"` and
  `payment_hash` (exactly 64 lowercase hex characters, or the record is skipped).
- Raw path: `boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/incoming-ph-<payment_hash>.json`,
  written with `allowOverwrite: false` like every raw record, so a repeat send is a no-op.
- Auth: a separate bearer token, `MSP_BOT_INGEST_TOKEN`, beside `HELIPAD_WEBHOOK_TOKEN`.
  A `source: "boostbox"` record is accepted only with the bot's token, and a Helipad
  record only with Helipad's. While `MSP_BOT_INGEST_TOKEN` is unset, bot records get 401
  and nothing else changes. `HELIPAD_WEBHOOK_TOKEN` can be removed after the webhook is
  off; `tools/import-helipad.mjs` stays for pre-cutover history.
- `ParsedBoost` and `DerivedBoost` gain `source: 'helipad' | 'boostbox'` and an optional
  `paymentHash`. Neither is a listener field; the privacy test in `boostRecord.test.ts`
  still applies.
- Records are keyed `h:<index>` (Helipad) or `ph:<payment_hash>` (bot). The key replaces
  `index` in the derived week's de-duplication map (`boostStore.ts`, `byIndex`) and as the
  sort tie-break. The raw path for Helipad records does not change.

## 2. One source per period: the cutover

Both sources hold the 252 shared boosts, and Helipad keeps writing until its trigger is
turned off. Rather than pair records, each record is chosen by **when it settled**:

- `BOOSTBOX_CUTOVER = 1769721533` (2026-01-29T21:18:53Z, the start of the bot's history
  window). A constant in `boostRecord.ts`, commented with where it came from.
- A derived week keeps **Helipad records settled before the cutover** and **boostbox
  records settled at or after it**, and drops the rest. That is 5 boosts and 1 stream
  from Helipad, everything later from the bot.
- **One function applies it — `selectSource(records)` in `boostStore.ts` — and every
  derived-week write goes through it:**
  - `rebuildWeekFromRaw` (webhook, daily cron) already reads every raw record of the week.
  - The import path (`{ week, records }` → `replaceDerivedWeek`) supplies Helipad records
    only. Before it writes, it adds that week's `incoming-ph-*` raw records and selects.
    Without this, re-running `tools/import-helipad.mjs` would replace the bot's records
    with Helipad's again.
- Helipad records written after the cutover (until the trigger is off) stay in raw and
  are simply not selected. Nothing is deleted.
- Why a cutover and not a twin rule: the measured overlap shows the bot misses nothing
  Helipad has, so there is nothing to merge — and a date is easier to check than a
  matching heuristic.

## 3. Song titles from Podcast Index

Helipad fills `remote_podcast` and `remote_episode` itself. For a boostbox record, MSP
does the same at ingest, so the resolver's `remote-guid` rung keeps its titles.

- When a boostbox record has `remote_feed_guid` and `remote_item_guid` in its TLV and no
  `remote_episode`, the ingest handler looks the item up in Podcast Index (episode by
  guid within the feed guid, auth from `api/_utils/podcastIndex.ts`) and adds
  `remote_episode` (the item title) and `remote_podcast` (the feed title) to the payload,
  with `resolved_by: "podcastindex"`, **before** the raw write. Raw is written once, so a
  rebuild never needs Podcast Index again.
- A failed or slow lookup (timeout 5 s) stores the record without them; the title then
  falls back to the listener's message, as it does today when Helipad has none. The
  record is never refused because of Podcast Index.

## 4. Weekly files become private

`boosts/derived/<week>.json` is a public blob at a fixed path and carries per-boost
amounts, which the chart deliberately never shows. Raw paths are protected by the secret
`MSP_BOOST_NAMESPACE`; derived paths are not.

- New derived path: `boosts/derived/<MSP_BOOST_NAMESPACE>/<week>.json`. `readAllDerived`,
  `replaceDerivedWeek` and `rebuildWeekFromRaw` use it; nothing reads the old path.
- Migration, in order:
  1. Deploy. The admin chart is empty until step 2 (acceptable: it is admin-only).
  2. Rebuild every week from raw into the new path. `/api/boosts/rebuild` gains an
     admin-only `?week=<key>` parameter; a local script walks the weeks a few at a time
     so each call fits the function timeout. Raw is complete, so no Helipad access is
     needed.
  3. Check the new weeks against the old ones. Until the bot's backfill runs, the
     cutover drops Helipad's post-cutover records and nothing replaces them yet, so
     compare the weeks before 2026-W05 exactly, and later weeks only after step 4 of the
     rollout.
  4. Delete the old top-level `boosts/derived/*.json` files with a one-off script that
     Chad runs. Only files directly under `boosts/derived/` — never the namespaced folder.

## 5. Bot changes (boostbox)

- **Config:** `BBN_FORWARD_URL`, `BBN_FORWARD_TOKEN`, and `BBN_FORWARD_ACTIONS` (default
  `boost,auto,stream`). URL or token unset → no forwarding, so the Boostr bot is
  unchanged. Only `msp-bot` sets them.
- **What is forwarded:** every payment that passes the recipient filter and whose action
  is in `BBN_FORWARD_ACTIONS`. What is **published** is unchanged: `BBN_ACTIONS`
  (`boost,auto`). So a stream is forwarded to MSP but never posted to Nostr, and never
  POSTed to BoostBox.
- **When:** a publishable boost is forwarded after its Nostr note is published; a
  forward-only payment (a stream) is forwarded as soon as it is read. A forwarded payment
  hash is recorded in the state file so a re-read poll does not send it again.
- **`tlv` must be what Helipad would have seen,** or the resolver gives a different answer:
  - Keysend payment: the TLV `7629169` JSON exactly as decoded (`nwc/decode-tlv-value`),
    before `bg/normalize`. The result of `transaction->boost` carries it as `:tlv-json`.
  - Wallet's parsed copy (the fallback when the TLV is unreadable): that map, as JSON.
  - Boost-link (LNURL) payment: the fetched metadata, with blip-10 key names. **The
    BoostBox permalink is never put in `boost_link`** — MSP reads `boost_link` as the
    song's own URL, so a permalink would make every boost its own "song".
- **Failure never blocks a note or the cursor.** A send that does not return 200 is added
  to a `forward-pending` list in the state file (at most 500, oldest dropped first, with a
  log line when that happens) and retried at the start of each poll, oldest first. MSP
  ignores repeats, so a retry is always safe. A long MSP outage delays the chart; it does
  not stop the notes and loses nothing inside the limit.
- **Backfill:** `scripts/msp-forward-backfill.sh`, shaped like `bot-local.sh`. It prompts
  for the NWC string with echo off, walks the wallet from a start date, rebuilds each MSP
  payment exactly as the live bot does — streams included — and sends them to MSP in
  batches of 25. It never publishes to Nostr and never touches the deployed bot's state
  file. Re-running it is always safe.

## 6. Testing

Every test is written first and seen to fail.

- MSP:
  - A boostbox record with a valid `payment_hash` is parsed and stored at
    `incoming-ph-<hash>`; an invalid hash is skipped.
  - The bot token accepts only boostbox records, Helipad's only Helipad records; a wrong
    token gets 401.
  - `selectSource`: a Helipad record before the cutover is kept, one after is dropped; a
    boostbox record at or after the cutover is kept; a week holding both sources for the
    same boost counts it once.
  - The import path keeps the week's boostbox records.
  - Podcast Index: a song-guid record gets `remote_episode` / `remote_podcast` before the
    raw write; a failed lookup stores the record unchanged; a record that already has
    `remote_episode` is not looked up.
  - Derived files are written and read under the namespace. The existing privacy test
    passes with the new fields.
- boostbox:
  - A keysend payment forwards its TLV unchanged; a boost-link payment forwards no
    permalink in `boost_link`.
  - Unset config sends nothing. A stream is forwarded and not published; a boost is
    published and forwarded; a forwarded hash is not sent twice.
  - A failed send goes to `forward-pending` and is retried oldest first; the limit drops
    the oldest and logs it.
  - The backfill publishes nothing to Nostr.

## 7. Rollout

1. Merge MSP-2.0 #140 (chart admin-only) first.
2. MSP PR: boostbox source, cutover, import change, Podcast Index titles, private derived
   path. Deploy; run the derived migration (section 4); Chad sets `MSP_BOT_INGEST_TOKEN`
   in Vercel.
3. boostbox PR: forwarding (streams included), `forward-pending`, and the backfill script.
   `msp-bot` redeploys; Chad sets `BBN_FORWARD_URL` and `BBN_FORWARD_TOKEN` on it.
4. Chad runs `scripts/msp-forward-backfill.sh` from 2026-01-29.
5. Verify (section 8). Then Chad turns off the chart trigger in Helipad. Removing
   `HELIPAD_WEBHOOK_TOKEN` from Vercel is optional and can wait.

## 8. Verification

- Re-run the record-by-record match: every bot record from 2026-01-29 is in the chart; no
  Helipad record after the cutover is counted.
- Admin chart, all time: **344** boosts (5 from Helipad before the cutover + 339 from the
  bot). 596 would mean the cutover is not applied.
- Streams: 1 from Helipad before the cutover, plus the bot's streams since — at least the
  82 Helipad recorded.
- The 36 song-guid boosts keep their titles.
- Top tracks now include songs from StableKraft, Castamatic and BoostMeBitch boosts.
- `curl` of an old `boosts/derived/<week>.json` URL returns 404 after the deletion.

## Risks

- **One live source.** If the NWC connection is revoked or the wallet relay fails, the
  chart stops growing; the bot logs `session-failed` and, once reconnected, reads the
  missed payments from the wallet, so nothing is lost. Helipad's history stays in raw,
  and the trigger can be turned back on in minutes.
- **Streams at node scale.** The bot already reads every transaction on the node; only
  MSP-split streams are forwarded, about 10 a month measured.
