# Hosting, Podcast Index, podping and email sign-in

Read before changing hosted feeds, Podcast Index or podping calls, domains or email sign-in.

## Environment variables
- `PODCASTINDEX_API_KEY` + `PODCASTINDEX_API_SECRET`: without both, `/api/pisearch` and `/api/pisubmit` answer 500 and hosted saves get no PI id.
- `BLOB_READ_WRITE_TOKEN`: read-write key to every hosted feed and to `accounts/`. Redeploy after a rotation. When rotating because of exposure, do not take "delay expiration of old credentials" (keeps the old key alive up to 30 days).
- `CANONICAL_URL` (server, `getBaseUrl()`) and `VITE_CANONICAL_URL` (build time, `buildHostedUrl()`; redeploy to change) both default to `https://musicsideproject.com`.
- `PODPING_ENDPOINT_URL` (trailing slash) + `PODPING_BEARER_TOKEN`: without both, podping is skipped (`isPodpingConfigured()`) and `/api/podping` answers 501. `PODPING_HIVE_ACCOUNT` (equals `HIVE_ACCOUNT_NAME` on the Railway service) is used only by `/api/podping-verify` (501 without it).
- `RESEND_API_KEY` + `MSP_EMAIL_FROM`: without both, email no-ops (`isEmailConfigured()`). Rotating `MSP_SESSION_SECRET` signs every email user out. `MSP_EMAIL_HASH_KEY` is kept separate so sessions can rotate alone; rotating it orphans every email-owned feed and account index. `MSP_MAGIC_LINK_TTL_MIN` defaults to 15.

## Domains and canonical URL
- `musicsideproject.com` (and `www`) is canonical; `new.musicsideproject.com` and legacy `msp.podtards.com` are the same Vercel project. DNS is at Squarespace; `docs/dns-musicsideproject-backup-2026-06-17.txt` is the zone before cleanup.
- Hosted feed URLs always use the canonical domain, never the request host: `getBaseUrl()` on the server, `buildHostedUrl()` on the client. Any URL MSP writes into a feed goes through `buildHostedUrl()`, never `window.location.origin`, or a preview host or the Desktop App's Tauri origin gets published. The NIP-98 `u` tag still uses the origin: it names where the request goes.
- Match both domains in `isMspUrl` (`xmlParser.ts`), `isMspHosted` (`publisherControl.ts`), `isMspHostedUrl` (`api/_utils/feedReachability.ts`) and the CORS lists in `proxy-feed.ts` and `_utils/cors.ts`; the three helpers also match the `/api/hosted/` path (preview deploys). Never generate a `msp.podtards.com` URL.
- GET `/api/hosted/{id}.xml` with `Host` (or `X-Forwarded-Host`) exactly `msp.podtards.com` returns a literal 301 to the canonical URL, so apps and PI move the subscription. It is in code because `vercel.json` redirects emit 308, which Apple/PI do not treat as a feed move.
- `vercel.json` sends every other `msp.podtards.com` path (`/((?!api/).*)`) to the canonical domain (308). Keep it there with `api/` excluded: a dashboard domain redirect would also replace the feed 301.
- Feeds paying the MSP 1.0 node (`LEGACY_MSP_NODE_PUBKEY`) migrate on import.

## Hosted feeds (`api/hosted/`)
- Blobs `feeds/{feedId}.xml` and `feeds/{feedId}.meta.json`. `feedId` is the `podcastGuid` and must be a UUID (`isValidFeedId`; admin skips the check). XML max 1 MB.
- `POST /api/hosted` creates. The edit token is returned once and stored hashed. A valid Nostr `Authorization` or `X-Email-Session` sets the owner at creation.
- `PUT`/`DELETE /api/hosted/{id}` authorize via `isAuthorizedFeedWrite()`: edit token, Nostr owner, email owner (admin may DELETE without them). `PATCH` links an identity: edit token plus that identity. Admin only: `POST ?backup=<ts>` restores, `GET ?backups` lists.
- **A missing `.meta.json` is a refusal, never a migration path.** The meta holds the only credential (`editTokenHash`, `ownerPubkey`, `ownerEmailHash`) and `feedId` is public, so treating "no meta" as "no owner" lets anyone take a feed and its value splits. PUT and DELETE return 409 without meta; POST returns 409 when either blob exists and writes with `allowOverwrite: false`. Do not add a "legacy feed" write path. Tests: `feedId-takeover.test.ts`, `index-create-guard.test.ts`. Restore rewrites the XML only; it does not recreate meta.
- `backupFeed()` copies the feed before PUT, DELETE and restore (10 kept). `isDraft` skips PI and podping; a PUT without it keeps the stored state.
- GET returns the bytes itself (a redirect to the blob fails CORS) as `application/xml` (inline in browsers), `s-maxage=30` (`HOSTED_FEED_EDGE_TTL_S`), with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Keep both: user bytes on the origin whose localStorage holds edit tokens and the email session.
- Known risk, unfixed: blob reads pass a CDN with a 60 s floor, and meta rewrites (PUT, PATCH, `auth/verify`) and `addFeedToAccount` read, modify and write. Two changes to one blob within a minute can lose the first.

## Client save
- The `msp2-hosted-<guid>` record is per origin, so "no record" does not mean "new feed". `createOrClaimHostedFeed()` (`src/utils/claimHostedFeed.ts`) retries a create 409 as an update by each signed-in owner (Nostr, then email), stores `editToken: ''`, and reports `FEED_EXISTS_NOT_OWNED` when none owns it.
- Desktop App fork: `SaveModal.tsx` and `hostedFeed.ts` are forked there, so a change to either needs a matching fork edit.

## Podcast Index
- Non-draft hosted POST/PUT call `notifyPodcastIndex()`: `hub/pubnotify`, `schedulePodping()`, then `add/byfeedurl`. `addResult` (PI's reason) comes back only when no id does. PUT keeps an existing id. `PodcastIndexAddResult` is duplicated in `src/utils/hostedFeed.ts`; keep in sync.
- **A hidden feed is pinged, never registered.** Hosted POST/PUT pass `register: !hasItunesBlock(xml)`: pubnotify and podping still go out (that is what makes a directory re-read the feed and drop it), `add/byfeedurl` is skipped. SaveModal's `feedHidden` then shows one notice instead of the PI poll and "Add it manually", and skips the nsite PI submit; the manual "Submit to PodcastIndex" mode is left alone. `hasItunesBlock` lives in `feedUtils.ts`, not `xmlUtils.ts`, because the Desktop fork appends its own function to `xmlUtils.ts` and a new one there would conflict. Listing rules: `docs/claude/xml-round-trip.md`.
- **Registration is asynchronous.** `add/byfeedurl` queues the URL; PI makes the record only after its crawler fetches the feed, so a new feed's save usually returns no id. Never show that as a failure.
- PI knows a `podcastGuid` only after the crawl, so `podcastIndexId` is cached in `HostedFeedInfo` and seeds the toolbar PI button before the `/api/pisearch` fallback.
- SaveModal: after an upload, `published` hides Upload and turns Cancel into Done; `selectMode()`, the draft checkbox and Unlink must clear it. With no id it polls `/api/pisearch?q={guid}` (5 s, then 10 s, 9 tries), then offers Check again, and calls `onPodcastIndexPending` so `App.tsx` keeps watching after it closes (5 s, then 15 s, 12 tries). Opening the hosted panel on a feed with no known id runs one lookup.
- `/api/pubnotify` (manual submit, nsite follow-up, `publisherPublish.ts`): pubnotify, `schedulePodping()`, lookup by GUID then URL, then always `add/byfeedurl` (a known GUID can have a new URL). `/api/pisubmit`: `add/byfeedurl` only; PI's `status: "false"` becomes 400.
- `/api/pisearch?q=` routes a PI URL or number to `byfeedid`, a UUID to `byguid`, an http(s) URL containing `.xml`, `/feed` or `rss` to `byfeedurl`, and anything else to full-text `byterm`, whose first hit need not be the feed asked for.
- `pubnotify`, `pisubmit` and `podping` run `getFeedUrlError` and the submit guard (`force` bypasses). All are public CORS (the WordPress plugin), limited per IP per warm lambda: pisearch 300/h, pisubmit 30/h, pubnotify 60/h, podping 10/h, podping-verify 60/h.

## Podping
- `notifyPodping()` sends `GET {PODPING_ENDPOINT_URL}?url=&reason=&medium=` with the bearer token to MSP's podping-hivepinger on Railway (`ChadFarrow/msp-podping-service`). One fetch, no retry, on purpose: hivepinger owns queueing and retries.
- **Hosted feeds wait `HOSTED_FEED_SETTLE_MS` (100 s = 60 s blob CDN floor + 30 s edge TTL + 10 s)**, then `schedulePodping()` sends a 2nd pubnotify and the podping. Listeners such as v4vmusic fetch within seconds and do not look again, so an early ping spreads the old bytes. Only `isMspHostedUrl()` URLs wait. The wait uses Vercel's `waitUntil`, read from the request context (a `@vercel/functions` dependency would need a Desktop fork port); off the platform it pings at once. `functions.maxDuration` in `vercel.json` (130 s for `api/hosted/*.ts` and `api/pubnotify.ts`) must stay above the wait plus the PI calls; raising `HOSTED_FEED_EDGE_TTL_S` raises the wait.
- **`medium` is load-bearing.** hivepinger names the op `pp_<medium>_<reason>`; the `msp-podping-service` consumer reads only `pp_music_*`, and no medium gives `pp_podcast_*`. Hosted POST/PUT (`extractPodcastMedium()`), every `/api/pubnotify` caller and `PodpingModal` pass the feed's medium; a new trigger must too. Publisher feeds send `publisher`, ignored on purpose.
- `/api/podping` (toolbar button, `PodpingModal.tsx`) pings at once. Its 200 means queued, so the modal polls `/api/podping-verify` (3 s, then 5 s, 6 tries, `since` = send time). It retries the check, never the send.
- `/api/podping-verify?url=&since=<epochMs>` scans the last 100 `custom_json` ops of `PODPING_HIVE_ACCOUNT` for a `pp_*`/`podping` op containing the URL. **`since` is load-bearing**: without it an older ping reports success at once (60 s skew allowed). No Hive node reachable gives 502, never `landed:false`. Known false negative: hivepinger dedups a repeat ping sent moments after the last.
- Automatic podpings are fire-and-forget (failures only in Vercel logs).
- A landed podping does not mean the feed indexes: a host that blocks crawlers (often Cloudflare Bot Fight Mode) leaves it blank in PI (`lastGoodHttpStatusTime: 0`), hence the submit guard on `/api/podping`. On "nothing showed up", check PI `podcasts/byfeedurl` `lastHttpStatus` first.
- "v4vmusic did not update": compare `feedUrl` in `https://v4vmusic.com/api/albums?search=<title>` with the pinged URL. A row at `msp.podtards.com` ignores canonical pings; one ping at the old URL fixes it (v4vmusic follows the 301).

## Nostr feed pointer (`api/feed/[npub]/[guid].ts`)
302s to the URL in the newest kind-1063 event for the npub and GUID. That URL is attacker-controlled, so it must be http(s); an attacker's own https site stays possible (proxying would trade phishing for SSRF).

## Email magic-link ownership
A third owner type beside edit token and Nostr; not experimental.
- Only `emailHash` (HMAC) is stored, never the email. Sessions are stateless HS256 JWTs (30 days) in `X-Email-Session: Bearer <jwt>` (`api/_utils/emailAuth.ts`).
- Blob has no private mode, so `accountStore.ts` uses public, unguessable paths: `accounts/links/<sha256(token)>.json` (deleted on redeem) and `accounts/index/<emailHash>.json` (feed GUIDs only).
- `POST /api/auth/magic-link` always answers `{sent:true}` (no enumeration), allows 5 per 15 min per IP and per email, and a `claim` must prove the edit token. `getVerifyOrigin()` accepts `*.vercel.app` only when `VERCEL_ENV !== 'production'`, or a forged host header could aim a real MSP email at another site. `POST /api/auth/verify` redeems; a claim stamps `ownerEmailHash` and indexes the feed. `GET /api/account/feeds` lists.
- SaveModal prefers Nostr, then email, then edit token. Not yet email-aware: "Browse My MSP Feeds" (`CatalogFeedsSection.tsx`) and `/admin`.
- DNS: SPF `include:_spf.resend.com` merged into the one SPF TXT, Resend's DKIM records, a DMARC TXT (`p=none` to start); verify the domain in Resend. No MX (send only).
