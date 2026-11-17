# API security

Read before changing anything in `api/` that fetches a user-supplied URL, rate-limits, sets CORS or handles auth, before adding a feed-URL input that submits to Podcast Index (PI) or podping, and before bumping a dependency.

## Dependencies

- `fast-xml-parser` is the only dependency that parses untrusted input (any host's feed, in the user's browser), so its advisories are urgent. Build-tool advisories (`rollup`, `postcss`, `esbuild`, `tar`) never reach the app; don't force them through.
- Update one package at a time, check the lockfile diff size, run `npm run build` after each (a bulk toolchain update once broke `tsc`; `npm ci` recovers). Prefer updates inside the semver range.
- Code must work across the whole `^` range: the Desktop App fork's lockfile resolves it differently. Library hooks take exactly the documented arguments (the one-argument `sha256` hook in `api/_utils/adminAuth.ts`: `@noble/secp256k1` 3.1 passes two, and the extra `undefined` failed every NIP-98 signature).
- A bump does not reach the fork intact (the sync keeps the fork's lockfile, `npm ci` fails). Port it to the fork before the upstream PR merges.

## Known open issues

- NIP-98 (`api/_utils/adminAuth.ts`) checks kind, a ±300 s window (`Math.abs`: future events pass) and the signature, never the `u`/`method` tags the client sends, and has no nonce: one event replays across endpoints and verbs. `api/admin/challenge.ts` mints a challenge nothing checks.
- `POST /api/hosted` is unauthenticated and unlimited; `feedId` is the client's `podcastGuid`, so a squatter can 409 the real owner forever.
- The admin branch of `api/hosted/[feedId].ts` skips `isValidFeedId`; with the replay above, that allows blob writes outside `feeds/`.
- Async handlers that `await` and then dispatch by array index can hit the wrong row after a reorder (`handleRefreshArtwork` in `CatalogFeedsSection.tsx`, the duration/size handlers in `Editor.tsx`). Dispatch by stable id.
- `GET /api/hosted/` hydrates every feed before filtering by owner, and accepts NIP-98 from any pubkey.

## Fetching a user-supplied URL

`/api/verify-feed-url` and `/api/proxy-feed` have no domain allowlist, because musicians self-host on domains no list covers. Don't collapse them: `verify-feed-url` returns a verdict and never the bytes (tests assert it; returning content would make it an open SSRF proxy), while `proxy-feed` returns only feed-shaped, capped bytes with a forced content type.

- **`_utils/urlSafety.ts`**: `assertPublicHttpUrl()` checks protocol, `isPrivateHost()`, then every DNS-resolved address (stops a public hostname pointed at `169.254.169.254`). `isPrivateHost()` runs its IPv6 prefix tests (`fc`, `fd`, `fe80:`) only when the host contains a colon; ungated, they refuse `fdrecords.com` or `fcc.gov`. Resolved IPv6 is checked in `isPrivateAddress()`.
- **`_utils/safeFetch.ts`** (shared transport): `safeFetchFollow()` walks redirects with `redirect: 'manual'` and checks every hop (default 5 hops). It strips userinfo from every redirect target, because `new URL(location, current)` keeps it and Node's fetch sends it as `Authorization`. `readCapped()` returns `{ text, truncated }`; a caller that returns bytes must refuse on `truncated`. It makes no policy decisions (a 503 is `ok: true`); don't add any, and keep the no-bytes rule in `feedProbe.ts`.

### `api/proxy-feed.ts`

Six guards replaced the old allowlist; dropping any one reopens an SSRF read primitive: (1) per-hop `assertPublicHttpUrl`; (2) `MAX_BODY_BYTES` 4 MB, oversize refused with 413, never truncated; (3) feed sniff (`<rss`/`<feed`/`<channel`) within `SNIFF_WINDOW` 64 KB before any byte is written; (4) fixed outbound headers, userinfo rejected; (5) no upstream header echoed, `Content-Type: application/xml` plus `nosniff` forced (echoing `text/html` is stored XSS on our origin); (6) `proxy-feed:` rate limit.

- 4 MB sits under Vercel's 4.5 MB response ceiling; above ~4.4 MB the user gets Vercel's opaque error instead of MSP's 413. Large feeds use the client's direct fetch.
- `MAX_REDIRECTS` 10: shared hosting chains http, https, www, slash, CDN, region.
- Widen `SNIFF_WINDOW` only with evidence: more bytes, more room to hide a marker.
- Own CORS allowlist (MSP hosts, `https://*.vercel.app`, local Vite); a wildcard makes MSP an open RSS relay.
- No `getFeedUrlError()`: those rules are about PI submission, not fetchability.
- Error codes are mirrored by `CODE_MESSAGES` in `src/utils/xmlParser.ts`.
- `TIMEOUT_MS` 8 s fits Vercel's default duration; raise `maxDuration` in `vercel.json` with it.
- Residual: DNS rebinding between the check and `fetch`. Fix is an undici `Agent` whose `connect.lookup` pins the checked IP; guard 3 bounds it.

### `_utils/feedProbe.ts`

- One probe for `/api/verify-feed-url` and the submit guard, so the warning and the refusal never disagree.
- One preflight, then two walks with `startAlreadyChecked: true`, so a blocked first hop (403 refusal) stays distinct from a redirect into one (verdict `unsafe`, not `blocked`: `blocked` means the host's WAF refused us).
- A bare GET and a ranged GET (`Range: bytes=0-2047`, 206 is success) in parallel; any 401/403/429 means `blocked`. Bot protection scores request shape, so one sample is a coin flip. Keep two probes and keep them different.
- `ProbeVerdict` stays on the wrapper: the endpoint serialises `outcome` verbatim, so a field added to `FeedProbeOutcome` ships publicly.
- `VERIFY_TIMEOUT_MS` 10 s; `GUARD_TIMEOUT_MS` 4 s (a WAF answers at once; only fail-open cases are slow). The guard runs in `pubnotify` (130 s `maxDuration`, then up to four PI calls), `pisubmit` and `podping` (default). Raising it or adding work after it means checking `maxDuration` in `vercel.json`.

**Before and after touching any fetch guard**, run `MSP_FEED_CORPUS=1 npx vitest run api/_utils/feedCorpus.network.test.ts`. Every other test mocks `fetch` and so cannot catch a guard refusing a good feed; this one points the real `proxy-feed.ts` constants at real feeds. A failure may just be a host being down.

## Hardening invariants (don't undo)

- `GET /api/hosted/{id}.xml` sends `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`: it serves user bytes from the origin whose `localStorage` holds edit tokens and the email JWT, and the CSP blocks `<?xml-stylesheet?>` XSLT. Podcast apps ignore both.
- `getVerifyOrigin()` (`api/auth/magic-link.ts`) accepts `*.vercel.app` only when `VERCEL_ENV !== 'production'`, or `X-Forwarded-Host` could aim a real magic-link email at an attacker's Vercel project.
- `api/feed/[npub]/[guid].ts` redirects only to `http(s)`; the pointer is attacker-controlled. Proxying the bytes instead would trade phishing for SSRF.
- Free-form secrets (`MSP_ADMIN_KEY`, ingest tokens) use `timingSafeEqualString()`, never `===` or `timingSafeEqualHex` (its `Buffer.from(x, 'hex')` drops non-hex input, so different secrets can match).
- `hydrateFeed()` strips `editTokenHash`; `ownerEmailHash` stays because `ImportModal` reads it.
- `escapeXml` at every interpolation in `xmlGenerator.ts`, attributes too; a type proves nothing (`podcast:medium` is a cast).

## Rate limits (`_utils/rateLimiter.ts`)

One shared `Map`: always prefix the key, or two endpoints share a bucket and one trips on the other's traffic. Per hour unless noted: `pisearch:` 300, `pisubmit:` 30, `pubnotify:` 60, `podping:` 10, `podping-verify:` 60, `verify-feed-url:` 30, `proxy-feed:` 60, `feed-guard:` 60, `boost-ingest:` 600, `boost-chart:` 120, `magiclink:ip:` and `magiclink:email:` 5 per 15 min.

- Per warm lambda, not global. They stop casual abuse, not attackers; real limits need shared state.
- No limit: `/api/hosted` and `/api/hosted/{id}` (all verbs), `/api/auth/verify`, `/api/account/feeds`, `/api/feed/{npub}/{guid}` (4 relay sockets), `/api/boosts/coverage`, `/api/admin/*`, `/api/op3check`.

## CORS (`_utils/cors.ts`)

- `applyCors(req, res, { methods, headers?, public? })`: restricted mode echoes an `ALLOWED_ORIGINS` entry (MSP hosts, Tauri webviews, local Vite); `public: true` sends `*`. Call it before the method check so errors carry the header, or browsers report "Failed to fetch".
- Byte-identical to the Desktop App fork's copy (the sync keeps the fork's version of a differing file). Change both together.
- Public: every endpoint the WordPress plugin calls from artists' own domains (`pisearch`, `pisubmit`, `pubnotify`, `podping`, `podping-verify`, `verify-feed-url`, `hosted/index`, `hosted/[feedId]`, `account/feeds`, `auth/magic-link`, `auth/verify`; pinned by `api/cors-public.test.ts`). Safe only because auth is request headers, never cookies; an endpoint that reads a cookie must leave the list. The file's "read-only endpoints only" comment is out of date.
- Never public: `proxy-feed` and the admin and boost endpoints.

## Feed URL validation

`src/utils/urlValidation.ts` is mirrored in `api/_utils/urlValidation.ts`; the `src/api mirror` test requires them byte-identical except the api copy's first 3 lines. Edit one, copy to the other.

- `normalizeFeedUrl()` trims only the ends. Interior whitespace is kept and rejected by `getFeedUrlError()`, which says to rename the file at the host (deleting or `%20`-encoding would guess the filename). `getFeedUrlError()` normalizes internally.
- Whitespace rule is `/\s/`: `new URL()` silently deletes interior tab/LF/CR.
- The apostrophe rule matches all apostrophe shapes (`'’‘ʼʻ＇`); rule order picks the message shown.
- `%27` is not matched: PI stores it and it fetches. These rules are a hard 400 on `pisubmit`, `pubnotify`, `podping`, `podping-verify` and `verify-feed-url`, so any new rule blocks feeds.
- Normalize in `onChange`, not on paste or blur. Handlers re-normalize (`url: rawUrl`, then `normalizeFeedUrl(rawUrl)`), as do `notifyPodping()` and `notifyPodcastIndex()`.

## Reachability: two layers

A clean URL can still 404, or 403 PI's crawler, leaving a blank PI entry while MSP reports success.

**Layer 1, client advisory** (`src/utils/verifyFeedUrl.ts`), in the six manual feed-URL inputs: `SaveModal`, `PodpingModal`, `Editor` publisher URL, `PublisherFeedReminderSection`, `CatalogFeedsSection`, `DownloadCatalogSection`. Never blocking: it warns and sets a bypass latch (`bypassVerify` or a variant) that relabels the button "Submit anyway". Our own outage (network error, non-200 other than 403, bad JSON) returns `ok: true`. Reset warning and latch in `onChange`.

**Layer 2, server guard** (`guardFeedSubmission()`, `_utils/feedReachability.ts`), inline in `pubnotify`, `pisubmit` and `podping`, so it also covers automatic submits with no field (`publisherPublish.ts`, SaveModal's nsite follow-up, the post-hosting ping).
- Refuses only on `blocked`; everything else fails open.
- `force` (`wantsForce()`) skips it; on the client it is the bypass latch sent over the wire. Don't add a second refusal state.
- Refusal is 400 `{ error, reachability }`. The client detects it with `isGuardRefusal()` (structural), shows `error` and arms the latch, or the next click is refused again. `GuardRefusal` is duplicated in `verifyFeedUrl.ts`.
- `isMspHostedUrl()` skips MSP hosts and any `/api/hosted/` path (preview deploys).
- A forced submit never reports clean success: `FORCED_SUBMIT_NOTE`, or `PodpingModal`'s own wording.
- Exhausting the `feed-guard:` budget skips the probe, never refuses.
- Endpoint tests `vi.mock` `./_utils/feedReachability.js`, or the guard eats their `fetch` mocks and calls live DNS.

**A new manual feed-URL input needs all five:** `normalizeFeedUrl` in `onChange`; `getFeedUrlError` gating the button; a `verifyFeedUrl` pre-flight with the latch; `force` and `isGuardRefusal` wired to that latch; `normalizeFeedUrl` again at the send site.

`DownloadCatalogSection` re-checks PI with a `piCheckNonce` in the lookup effect, never by editing `publisherFeedUrl` (stamped into every `<podcast:publisher>`). Keep the nonce out of the auto-populate effect, or it restarts polling.
