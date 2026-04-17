# Podping via self-hosted hivepinger — design

Date: 2026-04-17
Branch: `claude/evaluate-pypodping-alternative-4SXWh` (PR #47)

## Goal

Give MSP 2.0 the ability to send Podping notifications on feed publish/update, so indexers (Podcast Index, Fountain, Wavlake, etc.) re-crawl MSP-hosted feeds quickly. Replace the podping.cloud scaffolding on PR #47 with a self-hosted `podping-hivepinger` deployment on Railway.

## Non-goals

- Per-user Hive accounts. One MSP-owned Hive account posts all podpings.
- Running a full Hive node. Hivepinger signs and broadcasts via public RPC.
- Bulk "ping all my feeds" UI. YAGNI.
- Admin UI for podping history / retry. Hivepinger handles its own queue.

## Architecture

```
 Browser ──► MSP Vercel (Node) ──bearer──► Railway (Caddy ──► hivepinger) ──► Hive ──► indexers
```

Three layers:

1. **MSP** (Vercel, existing): auto-fires podpings on hosted feed create/update; exposes `/api/podping` for manual pings. Never talks to Hive directly.
2. **Railway service** (new repo, `ChadFarrow/msp-podping-service`): unmodified `brianoflondon/podping-hivepinger` image, fronted by Caddy sidecar that validates a shared bearer token before reverse-proxying to hivepinger:1820.
3. **Hive blockchain**: hivepinger signs `podping` `custom_json` ops with the MSP Hive posting key. Indexers watch Hive for podpings and pick up updates (Podping is permissionless — no notifier approval required).

## Railway service

### Repository layout (new repo)

```
msp-podping-service/
├── compose.yml
├── Caddyfile
└── README.md
```

### compose.yml

```yaml
services:
  hivepinger:
    image: ghcr.io/brianoflondon/podping-hivepinger:<pinned-tag>  # pin to a specific tag at deploy time; never :latest
    environment:
      HIVE_ACCOUNT_NAME: ${HIVE_ACCOUNT_NAME}
      HIVE_POSTING_KEY: ${HIVE_POSTING_KEY}
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "${PORT}:8080"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    environment:
      PODPING_SHARED_SECRET: ${PODPING_SHARED_SECRET}
    depends_on:
      - hivepinger
    restart: unless-stopped
```

### Caddyfile

```caddy
:8080 {
    @authorized header Authorization "Bearer {$PODPING_SHARED_SECRET}"
    handle @authorized {
        reverse_proxy hivepinger:1820
    }
    handle /health {
        respond "ok" 200
    }
    respond "Unauthorized" 401
}
```

### Railway env vars

| Name | Purpose |
|---|---|
| `HIVE_ACCOUNT_NAME` | MSP's Hive username |
| `HIVE_POSTING_KEY` | Hive posting key (STM… prefix) |
| `PODPING_SHARED_SECRET` | 32+ char random string; shared with MSP |

## MSP changes

### Env var renames

| Before (PR #47) | After | Purpose |
|---|---|---|
| `PODPING_TOKEN` | `PODPING_BEARER_TOKEN` | Bearer token shared with Railway |
| *(none)* | `PODPING_ENDPOINT_URL` | Railway URL, trailing slash (e.g. `https://podping-abcd.up.railway.app/`) |

Both must be set for podpings to fire. If either is unset, `notifyPodping()` no-ops and `/api/podping` returns 501.

### `api/_utils/feedUtils.ts`

Replace the hardcoded `PODPING_ENDPOINT` constant with `process.env.PODPING_ENDPOINT_URL`. Change `Authorization: token` to `Authorization: \`Bearer ${token}\``. Otherwise keep the existing `notifyPodping(feedUrl, { reason?, medium? })` signature, fire-and-forget call site in `notifyPodcastIndex()`, and query-param shape (`url`, `reason`, `medium`) — the hivepinger HTTP API is identical to podping.cloud.

### `api/podping.ts`

Behavior unchanged. Update the 501 message to check both env vars. Add rate limiting: in-memory LRU `Map<ip, { count, resetAt }>`, 10 requests per hour per IP, return 429 with `Retry-After` header when exceeded. Module-level state — acceptable because Vercel warm functions share state per instance; cold starts reset the counter, which is a mild leak but fine for a best-effort notification endpoint.

### SaveModal "Send Podping" destination

New row, appended after "Host on MSP", shown for all three feed modes.

- **URL field** — pre-fill priority:
  1. `album.hostedFeedUrl`
  2. Blossom pointer URL (`${origin}/api/feed/{npub}/{podcastGuid}.xml`) if published to Blossom
  3. nsite gateway URL if published to nsite
  4. empty
- **Reason** dropdown: `update` (default), `live`, `liveEnd`
- **Medium** — read from `album.medium` (Podcasting 2.0 `<podcast:medium>` value already stored on the feed). Not user-editable in this row. Omitted from the request body if unset — hivepinger treats medium as optional.
- **Submit** → `POST /api/podping` with JSON `{ url, reason, medium }`. Spinner while in-flight, inline success/error text, toast on completion.
- **Auth** — no Nostr login gate (matches existing PodcastIndexModal pattern). Abuse controlled by IP rate limit on `/api/podping`.

Mirror the row in the SaveModal help popup so the two stay in sync.

### CLAUDE.md

Rewrite the Podping paragraph under "Feed Hosting & Podcast Index" to describe the hivepinger + Railway architecture. Replace all references to `podping.cloud` and `PODPING_TOKEN`. Add `PODPING_ENDPOINT_URL` and `PODPING_BEARER_TOKEN` to the env var section.

## Data flow

### Auto-fire (existing)

```
POST /api/hosted           PUT /api/hosted/[feedId]
         │                          │
         └──► notifyPodcastIndex(stableUrl, { medium })
                     │
                     ├─ pubnotify fetch (PI re-crawl trigger)
                     ├─ void notifyPodping(stableUrl, { medium })   ← fire-and-forget
                     └─ add/byfeedurl fetch (PI registration)
```

### Manual (new)

```
SaveModal row submit
         │
         └──► POST /api/podping  { url, reason, medium }
                     │
                     ├─ IP rate-limit check (10/hr)
                     ├─ URL validation
                     └─ await notifyPodping(url, { reason, medium })
                              │
                              └─► fetch Railway with Bearer
                                          │
                                          └─► hivepinger queues, dedups,
                                              broadcasts to Hive
```

## Error handling

| Condition | Behavior |
|---|---|
| `PODPING_ENDPOINT_URL` or `PODPING_BEARER_TOKEN` unset | `notifyPodping` returns `{ ok: false, error: ... }`; auto-fire silently no-ops; `/api/podping` returns 501 |
| Railway unreachable / network error | `notifyPodping` returns `{ ok: false, error }`; auto-fire logs warning; `/api/podping` returns 502 |
| Caddy rejects bearer (401) | Surfaced as 401 in manual path; logged in auto-fire |
| Hivepinger queue full / 5xx | Surfaced with hivepinger's status code |
| Rate limit hit (manual only) | 429 with `Retry-After: 3600` |
| Invalid URL param | 400 |

Auto-fire never blocks or retries — podping is best-effort. Hivepinger itself handles its queue + dedup + Hive retries internally, so MSP doesn't need retry logic.

## Testing

### Unit — `api/_utils/feedUtils.test.ts` (new)

- No-op when `PODPING_ENDPOINT_URL` unset → `{ ok: false, error: '...not configured' }`
- No-op when `PODPING_BEARER_TOKEN` unset → same shape
- Builds query string with `url`, `reason`, `medium` (and omits optional ones when not provided)
- Sends `Authorization: Bearer ${token}` header
- Success path returns `{ ok: true, status: 200 }`
- Railway 5xx returns `{ ok: false, status, error }`
- Network failure returns `{ ok: false, error: message }`

Mock: `vi.spyOn(global, 'fetch')`.

### Unit — `api/podping.test.ts` (new)

- Rejects non-GET/POST (405)
- Rejects missing/invalid URL (400)
- Returns 501 when either env var unset
- Forwards to `notifyPodping`, surfaces 200 on success
- Surfaces Railway error status on failure
- Rate limit: 11th request from same IP within an hour returns 429 with `Retry-After` header

### Component — SaveModal podping row

- Pre-fills URL from `album.hostedFeedUrl` when available
- Falls back to Blossom pointer URL, then nsite URL, then empty
- Submit button disabled with empty URL
- Shows success state after 200 response
- Shows error state after non-200 response
- Medium read from `album.medium` and included in the request body when set; omitted when unset

### Out of scope for tests

- Real Hive broadcast (flaky, slow, not useful)
- Railway service itself (unmodified upstream image; Caddy config trivial)
- End-to-end from publish → Hive — covered by the one-time manual smoke test

## One-time manual setup

1. Hive account on `v4v.app` (done). Any funded Hive account works — no notifier approval required.
2. Posting key exported (done)
3. Create `ChadFarrow/msp-podping-service` repo with files in Section 2
4. Connect Railway to that repo, set `HIVE_ACCOUNT_NAME`, `HIVE_POSTING_KEY`, `PODPING_SHARED_SECRET` (generate with `openssl rand -hex 32`)
5. Copy Railway public URL + shared secret to Vercel MSP env: `PODPING_ENDPOINT_URL`, `PODPING_BEARER_TOKEN`
6. Smoke test: `curl "$MSP/api/podping?url=https://msp.podtards.com/api/hosted/<feedId>.xml"` → 200; watch `hiveblocks.com/@<account>` for a `custom_json` op with id `podping`

## Rollback

Unset `PODPING_BEARER_TOKEN` or `PODPING_ENDPOINT_URL` on Vercel. `notifyPodping` no-ops, auto-fire stops silently, manual endpoint returns 501. No redeploy needed.

## Open questions

None remaining after brainstorming. Listed here for future reference:

- Dedup on MSP side? — No, hivepinger does it.
- Retry on MSP side? — No, hivepinger does it.
- Persist rate limiter across cold starts? — Not now. Revisit if abuse emerges.
