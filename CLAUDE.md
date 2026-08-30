# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reporting Language

Write every reply to the user in ASD-STE100 Simplified Technical English.

- Use only approved STE words, and use one meaning for each word.
- Write short sentences: 20 words maximum for an instruction, 25 for a
  description.
- Give one instruction in each sentence.
- Use the active voice and simple verb tenses.
- Do not use a noun cluster of more than three words.
- Keep the articles. Do not use slang, idioms, or jargon.

This rule applies to chat replies only. Code, code comments, commit messages,
pull request text, file contents, and quoted material keep their normal style —
do not rewrite existing prose into STE.

## Project Overview

MSP 2.0 (Music Side Project Studio) is a React web application for creating Podcasting 2.0 compatible RSS feeds for music albums, videos, and publisher catalogs. It supports Value 4 Value (Lightning Network payments), Nostr integration for cloud sync, and Podcast Index integration.

## Development

### Prerequisites
- Node.js v22+
- npm

### Environment Setup
A `.env` file is required with the following variables:
- `PODCASTINDEX_API_KEY` - Podcast Index API key
- `PODCASTINDEX_API_SECRET` - Podcast Index API secret
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token. **Read-write: it is the key to every hosted feed** (`feeds/*.xml`, the meta blobs, and the whole `accounts/` namespace whose privacy model is "unguessable paths"). Vercel owns this one — the Blob store injects it into connected projects, and rotating it in the dashboard updates the env var automatically, but **active deployments must be redeployed to pick it up**. It was committed to this public repo in `63c2de2` (Jan 2026) and removed the same day in `5535933`; removing a file does not remove its blob, so it stayed readable in history — and in the Desktop App fork — until rotated in Aug 2026. If you ever rotate again, do **not** take Vercel's "delay expiration of old credentials" option when the reason is exposure: that keeps the leaked key alive for up to 30 days
- `MSP_ADMIN_PUBKEYS` - Admin public keys for authentication
- `MSP_ADMIN_KEY` - **Second, static full-admin path that bypasses NIP-98 entirely.** A long-lived bearer secret accepted via the admin header by `api/hosted/index.ts` and `api/hosted/[feedId].ts`; if set, it grants restore/delete/backup on any feed with no Nostr signature. It went undocumented here for a long time — if you don't need it, unset it rather than leaving a spare key under the mat. Compared with `timingSafeEqualString()` (see the hardening notes below for why not the hex variant)
- `VITE_CANONICAL_URL` - Canonical URL for the application
- `PODPING_ENDPOINT_URL` - Full URL to MSP's self-hosted podping-hivepinger Railway service, trailing slash (optional; podping notifications are skipped when unset)
- `PODPING_BEARER_TOKEN` - Bearer token shared with the Railway service (optional; podping notifications are skipped when unset)
- `PODPING_HIVE_ACCOUNT` - MSP's Hive account name (same value as `HIVE_ACCOUNT_NAME` on the Railway service). Not a secret. Used only by `/api/podping-verify` to confirm a podping landed on-chain; the check no-ops (501) when unset
- `PODPING_HIVE_RPC_URL` - Override the Hive JSON-RPC node used by `/api/podping-verify` (optional; defaults to public nodes)
- `RESEND_API_KEY` - Resend API key for sending email magic links (optional; email auth no-ops when unset, gated by `isEmailConfigured()` in `api/_utils/sendEmail.ts`)
- `MSP_EMAIL_FROM` - Verified Resend sender address, e.g. `noreply@musicsideproject.com` (optional; required alongside `RESEND_API_KEY` for email auth)
- `MSP_SESSION_SECRET` - HMAC secret signing email session JWTs (server-only). Rotating it invalidates all email sessions
- `MSP_EMAIL_HASH_KEY` - HMAC key for `ownerEmailHash`. Kept separate from `MSP_SESSION_SECRET` so sessions can rotate without orphaning feed ownership. **Rotating this breaks email→feed ownership matching**
- `MSP_MAGIC_LINK_TTL_MIN` - Magic-link lifetime in minutes (optional; default 15)
- `HELIPAD_WEBHOOK_TOKEN` - Shared secret for `/api/boosts/ingest`. Helipad sends it as `Authorization: Bearer <token>` from a trigger; the import script sends the same. The endpoint 404s when this or `MSP_BOOST_NAMESPACE` is unset, so boost capture simply does not exist until both are configured
- `MSP_BOOST_NAMESPACE` - One high-entropy path segment (16-128 chars of `[A-Za-z0-9_-]`) that the private raw boost tree lives under. **Not decorative:** Helipad's boost `index` is a small incrementing integer, so `boosts/raw/2026-08/10695.json` would be trivially enumerable if the blob store subdomain leaked, and raw records hold listener messages and sender names. Rotating it orphans the existing raw blobs; re-running the import script rebuilds them

No `.env.example` exists - request credentials from the team.

**Email auth DNS** (for magic-link deliverability on `musicsideproject.com`): add the SPF (`include:_spf.resend.com`, merged into a single SPF TXT), Resend DKIM records, and a DMARC TXT (`p=none` to start) — verify the domain in the Resend dashboard. MX is **not** required (send-only).

### Getting Started
```bash
npm install
npm run dev
```

## Deployment

- Hosted on Vercel; **musicsideproject.com** (apex + `www`) is the canonical domain and runs `master`
- Also answers on **new.musicsideproject.com** and the legacy **msp.podtards.com** alias — all the same Vercel project. DNS is managed at Squarespace (Google Domains nameservers). `msp.podtards.com` still resolves but must not appear in newly generated URLs
- API functions in `/api/` directory are Vercel serverless functions
- Dev server proxies `/api/*` to production (`musicsideproject.com`)
- Build: `npm run build` (tsc + vite)
- Build auto-unshallows Vercel's git clone for accurate version computation

### Typechecking — use `npm run build`, not `tsc --noEmit`
The root `tsconfig.json` is **references-only** (`files: []` + references to `tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.api.json`), so `tsc --noEmit` against it checks **zero files** and always passes — a false green. Always verify types with `npm run build` (`tsc -b && vite build`) or at minimum `npx tsc -b`. (Lint is separate: `npm run lint`.)

`tsconfig.api.json` exists because `api/` used to be typechecked by **nothing** — `tsconfig.app.json` includes only `src`, `tsconfig.node.json` only `vite.config.ts`, and Vercel's builder transpiles functions without checking them. Roughly 8k lines, including every auth path, the SSRF guards and feed CRUD, had no type gate. It excludes `api/**/*.test.ts` on purpose: handler tests pass `vi.fn()` mocks where a full `VercelResponse` is expected, which is normal for that style of test and would bury real errors in ~30 fake ones.

### CI — Vercel's green check is not a passing test run
`.github/workflows/ci.yml` runs `npm run build`, `npm run test` and `npm run lint` on every PR and on pushes to `master`. Before it existed the only checks were **Vercel** and **Vercel Preview Comments** — a build and a deploy — so a PR could break all 475 tests and still show green. All three are **blocking**. Lint was `continue-on-error` while `master` carried a 29-problem backlog; that backlog is now cleared and the step is enforced, so `master` is at zero and must stay there.

**Why lint is blocking rather than advisory**: the Desktop App fork lints these same files as a **blocking** job of its own. A lint error that lands here therefore holds its automated sync PR red — and fixing it *there* doesn't stick, because `sync-upstream` force-resets on every push to this repo. That is not hypothetical: two `as any` casts in `api/pisubmit.test.ts` slipped in under `continue-on-error` and were the only thing keeping desktop sync PR #35 red on lint (#115). Any rule this repo can't satisfy should be turned off in `eslint.config.js` deliberately, not left failing.

The two `eslint-disable-next-line react-hooks/set-state-in-effect` comments in the tree (one each in `InfoIcon.tsx` and `PublishSection.tsx`) are deliberate and carry their reasoning inline — a post-layout measurement and a progress-event accumulator, neither derivable during render. Note the directive must be the **last** line before the statement it suppresses; putting the explanation after it silently targets the wrong line and ESLint then reports the disable itself as unused.

**Actions are pinned to the current major** (`actions/checkout@v7`, `actions/setup-node@v7`), because v4 targets the deprecated Node 20 runtime and GitHub was already force-running them on Node 24 with a warning on every run. Two things worth knowing before bumping these again:
- **Keep `cache: npm` explicit.** setup-node v5 added *automatic* caching when `package.json` carries a `packageManager` field. This repo has no such field, so deleting that line would silently stop caching rather than fail — a slow CI job with no error to explain it.
- checkout's `allow-unsafe-pr-checkout` change was backported to **every** major including v4, so it is not a reason to prefer or avoid a version. The v7 restriction that does bite only applies to `pull_request_target` / `workflow_run`, neither of which this workflow uses.

### Domains & canonical URL
Hosted feed URLs (album/video/publisher) **always** use the canonical domain, never the request host:
- `getBaseUrl()` (`api/_utils/feedUtils.ts`) returns `process.env.CANONICAL_URL` (default `https://musicsideproject.com`), ignoring the request host — so a feed created via any alias/preview deploy still reports the canonical URL.
- `buildHostedUrl()` (`src/utils/hostedFeed.ts`) uses `VITE_CANONICAL_URL` (default `https://musicsideproject.com`) → `{canonical}/api/hosted/{feedId}.xml` (the URL submitted to Podcast Index). It's a **build-time** Vite var (`import.meta.env`), so changing it needs a redeploy. It no longer falls back to `window.location.origin`.
- MSP-hosted detection (`isMspUrl` in `xmlParser.ts`, `isMspHosted` in `publisherPublish.ts`) and `/api/proxy-feed`'s CORS origin list match both `musicsideproject.com` and the legacy `msp.podtards.com`.
- `/api/hosted/[feedId].xml` GET serves `Content-Type: application/xml` so browsers render feeds inline in a tab instead of downloading (podcast apps parse either XML content-type identically).
- Changing the canonical only affects **newly generated/re-saved** URLs; feeds already registered in Podcast Index keep their original URL until re-saved.
- **Legacy 301 redirect (feeds)**: the `/api/hosted/[feedId].xml` GET returns a literal `301` to `{canonical}/api/hosted/{feedId}.xml` when the request `Host` is exactly `msp.podtards.com`, so feeds first registered under the old domain migrate to the canonical URL in podcast apps / Podcast Index. Exact-host match + canonical target is loop-safe (canonical and `*.vercel.app` previews never match). Done in code (not `vercel.json` `redirects`, which emit 308 — Apple/PI don't treat 308 the same as 301 for feed migration). GET-only; management verbs (PUT/DELETE/POST) come from the app on the canonical host.
- **Legacy domain redirect (everything else)**: `vercel.json` has a host-conditional permanent redirect — `source: /((?!api/).*)` + `has` host `msp.podtards.com` → `https://musicsideproject.com/$1` — so the old domain's homepage and app routes redirect to the canonical domain. It **excludes `/api/`** on purpose, so the feed paths keep their in-function literal 301 above (a Vercel *dashboard* domain-redirect would clobber that — keep it in `vercel.json`). This is a 308 (fine for browser/app navigation; only feeds need the literal 301).

### Legacy site decommissioning (June 2026)
`musicsideproject.com` previously served the **original MSP Studio** — thebells1111's Svelte feed *generator* (https://github.com/thebells1111/msp-studio), unrelated to this codebase. It was decommissioned and the apex repointed to MSP 2.0. Notes:
- The original is a client-side generator (hosts no feeds/data/email), so the takeover broke no live podcast subscriptions. Source archived read-only at [ChadFarrow/msp-studio](https://github.com/ChadFarrow/msp-studio).
- The inherited Squarespace zone was full of non-functional junk records (Office-365/Zoho/Google email templates with no MX, DKIM-as-A records). Pre-cleanup backup + keep/delete classification: `docs/dns-musicsideproject-backup-2026-06-17.txt`. Only 4 records are real: `@`/`www` (apex → MSP 2.0), `new` CNAME, and the `_vercel` verification TXTs.
- Legacy MSP 1.0 feeds (from the old node-based tooling) are auto-migrated on import — see "Value recipient normalization on import" under XML Handling (`LEGACY_MSP_NODE_PUBKEY` → MSP 2.0 lnaddress).

### Assets & caching
- **Never import `src/assets/msp-logo.png` into a component.** It is a 1024x1024 PNG of **1,810,143 bytes**, byte-identical to `public/msp-logo.png` (same md5), and it renders at **40px** (`.header-logo`, `App.css`). Importing it bundled a *second* copy into `dist/assets/` while `public/` already served the first as the favicon, so a first visit pulled ~3.6 MB of logo against ~180 kB of compressed JS. `App.tsx` and `admin/AdminPage.tsx` now point at `/msp-logo-192.png` (66 kB) instead; measured `dist` total went 4,996,616 → 3,186,648 bytes. The full-size file stays for `og:image`, which only social crawlers fetch.
- The unused `src/assets/msp-logo.png` is **deliberately not deleted**. The Desktop App is a fork with its own `App.tsx`; deleting an asset here breaks its build when the sync PR lands — see the fork-divergence gotcha above.
- `vercel.json` gives `/assets/(.*)` `max-age=31536000, immutable`. Safe only because Vite content-hashes those filenames, so a URL's content can never change. **Don't extend it to `public/`** — `msp-logo*.png`, `manifest.json` and `info.md` have stable names and must stay revalidated.

### Versioning
Version is auto-computed at build time from git commit count: `0.1.{count - 255}` (zero-padded). Each push to master increments the patch number. Configured in `vite.config.ts` via `getAutoVersion()`, with `package.json` version as fallback when git is unavailable. Displayed in the hamburger menu.

## Dependencies & security posture

- **`fast-xml-parser` advisories are runtime, not build-time.** It's the only dependency that parses genuinely untrusted input — feeds fetched from arbitrary self-hosted domains via `/api/proxy-feed`, parsed in the user's browser, including every feed a publisher catalog's "Download All" walks. Its entity-expansion DoS advisories hang the importing user's tab. Treat a critical here as urgent; treat one in `rollup`/`postcss`/`esbuild` as housekeeping.
- **Don't bulk-update the toolchain.** `npm update vitest vite @vercel/node eslint` in one pass churned **2,632 lockfile lines** and broke `node_modules/.bin/tsc`, so the build failed outright with `sh: tsc: command not found`. Update one package at a time, check the lockfile diff size, and run `npm run build` after each. `npm ci` is the recovery.
- Prefer updates that stay **inside the existing semver ranges** — those are lockfile-only, need no `package.json` edit, and are what a fresh install would have resolved anyway.
- As of Aug 2026 the remaining advisories (1 critical transitive `tar`, ~13 high) are all build tooling and none reach the deployed app. Deliberately not forced through: the churn is a worse risk to a stable production site than the advisories are.

## Known security follow-ups (audited, not yet fixed)

Real findings from the Aug 2026 audit, left open on purpose because each is larger than the pass that closed everything around it:

- **NIP-98 is unbound to URL and method, and has no nonce.** `api/_utils/adminAuth.ts` checks kind, a ±300 s window and the signature — it never reads the `u`/`method` tags, though the client at `src/utils/adminAuth.ts` does send them. So one admin event replays across endpoints: an event signed for a feed listing also authorizes `DELETE`. `Math.abs` also accepts events dated 5 minutes into the *future*. `api/admin/challenge.ts` mints a challenge that is never stored or compared — it contributes nothing.
- **`POST /api/hosted` is unauthenticated and unlimited** — see the rate-limiter notes. Also enables GUID squatting: `feedId` is the client-supplied `podcastGuid`, so claiming someone's GUID first permanently 409s the real owner.
- **The admin branch skips `isValidFeedId`** (`api/hosted/[feedId].ts`), so `feedId` reaches blob paths unvalidated. Only exploitable in combination with the NIP-98 replay above, but the two compose into arbitrary blob writes outside `feeds/`.
- **Stale-index async writes.** Several handlers capture an array index, `await`, then dispatch back *by that index* into a list the user can reorder meanwhile — worst in `CatalogFeedsSection.tsx` (writes `feedUrl` into the published catalog) and `Editor.tsx`. Dispatch by `track.id`/stable id instead; `Editor.tsx` already keys its rows that way.
- `GET /api/hosted/` hydrates **every** feed before filtering by owner, and accepts any valid NIP-98 event from any pubkey.

## Software Versions

### Core
- React 19.2
- TypeScript 5.9
- Vite 7.2

### Key Libraries
- fast-xml-parser 5.3
- nostr-tools 2.19
- @vercel/blob 2.0

### Development
- Vitest 4.0
- ESLint 9.39

## Project Structure

```
src/
├── components/     # React components
│   ├── Editor/     # Album/Video editor components
│   ├── PublisherEditor/  # Publisher feed editor
│   ├── modals/     # Modal dialogs
│   └── admin/      # Admin components
├── store/          # React Context stores
│   ├── feedStore.tsx     # Main feed state
│   ├── nostrStore.tsx    # Nostr authentication
│   └── themeStore.tsx    # Theme state
├── types/          # TypeScript definitions
└── utils/          # Utilities (XML, Nostr, audio, storage)

api/                # Vercel serverless endpoints
```

## Boundaries

- TypeScript strict mode enabled
- `noUnusedLocals`, `noUnusedParameters` enforced
- ES modules only (`"type": "module"`)
- Target ES2022
- Never commit secrets (`.env`, API keys, tokens)

## Git Workflow

- Run `git pull` on startup to get latest changes
- Main branch: `master`
- Commit style: imperative tense ("Fix bug", "Add feature")
- Include Co-Authored-By for Claude-assisted commits
- No pre-commit hooks configured

### Desktop App Auto-Sync
Every push to `master` automatically triggers a sync to the [MSP-2.0-Desktop-App](https://github.com/ChadFarrow/MSP-2.0-Desktop-App) repo:
- `.github/workflows/notify-desktop.yml` sends a `repository_dispatch` event to the Desktop App repo on each push
- The Desktop App's `sync-upstream.yml` workflow receives the event, merges upstream changes, and creates a PR
- Daily schedule (6 AM UTC) and manual triggers also remain as fallbacks
- The Desktop App's sync workflow includes a "Remove web-only workflows" step that strips `notify-desktop.yml` (and any future web-only files) after merging upstream, preventing them from running in the Desktop App repo
- **Secrets**: `DESKTOP_SYNC_TOKEN` (this repo) — PAT with `repo` scope for dispatching; `SYNC_PAT` (Desktop App repo) — PAT with `repo` + `workflow` scope for pushing workflow file changes in PRs
- **The sync resolves every conflict as `--ours`, so a change to a diverged file does NOT reach the fork.** This is the single most misleading thing about the arrangement: a green sync PR looks like the change propagated, and for any file the fork has diverged on, it didn't. Worse, the upstream commit still lands in the fork's *history*, so git treats it as merged and **no future sync will re-offer it** — the content is silently skipped forever, not queued. Getting an upstream change into a diverged file takes a deliberate reconcile pass on the fork side (its PR #38 is the worked example). Assume nothing in `SaveModal.tsx`, `App.tsx`, `AdminPage.tsx`, `FeedList.tsx`, `Editor.tsx` or the `api/*.test.ts` files propagates on its own.
- **`ci.yml` conflicts on every single edit, by construction.** The fork *deletes* it (the "Remove web-only workflows" step, plus a commit on its master), so any upstream change to it is a **modify/delete** conflict. That case has no stage-2 ("ours") blob, and the fork's resolver used to run `git checkout --ours` across the whole conflict list at once — which errored on that one path and, under `bash -e`, **aborted the entire pass before resolving anything else**, producing no sync PR at all. Fixed in the fork (its PR #40) by resolving per-path and `git rm`-ing paths with no our-side version. If a sync ever again reports success upstream but no PR appears on the fork, check that step's log first.
- **Fork divergence gotcha**: the Desktop App's `src/App.tsx` is a fork (adds Tauri integration, FeedSidebar, stored-key auto-unlock, update checks, etc.) and lives in a different shape than upstream. The auto-sync git-merges file *deletions* cleanly but **cannot reconcile in-file edits** when the surrounding context differs. Concretely: if you delete an import + a toolbar button + a modal render from `src/App.tsx` here, the Desktop App's sync PR will pull in the deleted asset but leave its own (forked) `App.tsx` still referencing it, breaking the Vite build. When making cross-cutting App.tsx surgery upstream, expect to push a matching follow-up commit to the Desktop App's `sync-upstream` branch (or fix the merge conflict before merging the sync PR). Once the sync PR merges to `master` on the Desktop App side, its `Build & Release` workflow (`.github/workflows/release.yml`, Tauri matrix for macOS aarch64/x64, Ubuntu, Windows) fires and publishes a GitHub Release plus the auto-updater `latest.json`.

## GitHub Issues

Check GitHub issues for feature requests and bug reports:
```bash
gh issue list              # List open issues
gh issue view <number>     # View issue details
```

## Commands

```bash
npm run dev          # Start Vite dev server (proxies /api to musicsideproject.com)
npm run build        # TypeScript compile + Vite build
npm run lint         # ESLint
npm run test         # Run tests with Vitest
npm run test:watch   # Watch mode testing
npm run preview      # Preview production build
```

## Architecture

### Three Feed Modes
The app has three modes selected via dropdown in the header:
- **Album** - Music album RSS feeds with tracks
- **Video** - Video feed RSS (similar structure to Album)
- **Publisher** - Label/publisher catalog feeds that aggregate multiple album feeds

### State Management
Uses React Context + useReducer pattern (not Redux). Three separate stores:
- `feedStore.tsx` - Main feed state with album/video/publisher data, persisted to localStorage
- `nostrStore.tsx` - Nostr authentication state
- `themeStore.tsx` - Dark/light theme

Actions are dispatched via reducer pattern. The `FeedAction` union type in `feedStore.tsx` defines all available actions.

**`publisherFeedInstance` — feed-scoped local state must reset on import.** The publisher editor sections stay mounted across an import (`SET_PUBLISHER_FEED` swaps the data, nothing unmounts), so any `useState` they hold survives into the next feed. That's what made an imported feed show the *previous* feed's Publisher Feed URL in "Add Publisher to Catalog Feeds" — and that URL gets stamped into every catalog feed's `<podcast:publisher>` tag, so it's not just cosmetic. `FeedState.publisherFeedInstance` is a counter bumped by `SET_PUBLISHER_FEED` / `CREATE_NEW_PUBLISHER_FEED`; `PublisherEditor/index.tsx` passes it to `DownloadCatalogSection` and `PublisherFeedReminderSection`, which clear their URL fields and result banners when it changes (`useRef` compare, so it fires on change only). **`podcastGuid` can't serve as that key** — it's an editable text input, so keying on it would wipe the field on every keystroke there. Any new publisher section that holds feed-scoped local state (a URL, a "hosted!" banner, a submission result) needs the same reset.

### Core Data Types (src/types/feed.ts)
- `FeedType` - `'album' | 'video' | 'publisher'` (canonical definition, re-exported from `feedStore.tsx`)
- `Album` - Feed metadata + array of `Track`s
- `Track` - Individual items with optional per-track value recipients
- `Person` - Contributors with roles (uses Podcasting 2.0 taxonomy)
- `ValueRecipient` - Lightning payment recipient with split percentage
- `PublisherFeed` - Contains `RemoteItem`s referencing other feeds
- `RemoteItem` - Reference to another feed by GUID/URL

### API Layer (api/)
Vercel serverless functions:
- `pisearch.ts` - Podcast Index search
- `pisubmit.ts` - Submit feed to Podcast Index
- `pubnotify.ts` - Podcast Index pub notification + feed lookup; accepts optional `medium` query param and fire-and-forgets a podping via `notifyPodping()` in parallel so the toolbar "Podcast Index" button hits both indexing pathways
- `podping.ts` - Broadcast feed update via self-hosted hivepinger Railway service (requires `PODPING_ENDPOINT_URL` + `PODPING_BEARER_TOKEN`); rate-limited 10/hour per IP
- `podping-verify.ts` - Check whether a podping actually landed on Hive; scans the last 100 `custom_json` ops on `PODPING_HIVE_ACCOUNT` (≈2 months of history) for a `pp_*`/`podping` op whose payload mentions the feed URL. Takes `?url=&since=<epochMs>`; **`since` is load-bearing** — without it a podping for the same feed from an hour ago matches on the first poll and reports success before the real op lands (60 s skew allowance for browser-vs-Hive clocks; an unparseable value is ignored, not rejected). Rate-limited 60/hour per IP (the modal polls). Returns 501 when unconfigured and **502 when no Hive node is reachable — never `landed:false`**, so an RPC outage is never reported as a failed ping
- `proxy-feed.ts` - CORS proxy for fetching external feeds. Returns the fetched **body** to the browser, which is what makes it dangerous. It used to carry a 17-domain `allowedDomains` allowlist for exactly that reason — and that allowlist 403'd every self-hosted musician domain, breaking Import-from-URL and the publisher Download Feed button for the people MSP exists for. The allowlist was **replaced, not dropped**, by six guards that are all load-bearing: (1) `assertPublicHttpUrl` on the first hop *and every redirect hop* via `_utils/safeFetch.ts`; (2) a **4 MB** cap where an oversized body is **refused (413), never truncated-and-served** — half an XML document parses as a corrupt one; (3) a feed-shape sniff within a 64 KB window **before any byte is written**, so the endpoint can only ever return documents that look like RSS/Atom; (4) no client header is forwarded (fixed outbound set) and URLs with embedded credentials are rejected, since Node's fetch turns userinfo into an `Authorization` header; (5) no upstream header is echoed and `Content-Type` is **forced** to `application/xml` + `nosniff`, because passing through `text/html` would be stored XSS on our own origin; (6) a `proxy-feed:` rate limit (60/hr). CORS is restricted to the MSP origins + `*.vercel.app` — a wildcard would make MSP an open RSS relay for the whole web. It deliberately does **not** apply `getFeedUrlError()`: that rule table is about what's fit to submit to Podcast Index, and a feed URL that already contains an apostrophe is still perfectly fetchable. **Known residual (follow-up, not a regression):** `assertPublicHttpUrl` resolves the hostname and `fetch` resolves it again, so a TTL-0 record can rebind between the two; the fix is an undici `Agent` whose `connect.lookup` pins the checked IP. Guard 3 bounds the exposure.
  - **The 4 MB cap is pinned to Vercel, not chosen.** Vercel hard-caps a function's response body at **4.5 MB** (`FUNCTION_PAYLOAD_TOO_LARGE`). Raising `MAX_BODY_BYTES` above ~4.4 MB does not make bigger feeds work — it just replaces MSP's 413 (which explains itself and says "download the XML and import it as a file") with the platform's opaque one. The cap was 5 MB, i.e. *above* the ceiling, so bodies between the two hit Vercel's error. Genuinely large feeds are served by the client's direct fetch, which has no such ceiling; the proxy is only the CORS fallback. Real feeds do exceed this — a live Simplecast feed measured 18.5 MB.
  - **`maxRedirects: 10` here, not safeFetch's default of 5.** Five suits `verify-feed-url`'s 4 s budget, but shared hosting legitimately chains `http → https → www → trailing-slash → CDN → region`, and the pre-rewrite code used Node's `redirect: 'follow'` default of **20**. Passed per-call so `feedProbe` keeps 5.
  - **Guard 4 is enforced in two places.** Rejecting userinfo on the URL we were handed is not enough: `new URL(location, current)` carries userinfo through, so one redirect turns us back into a credential relay. `safeFetchFollow` strips `username`/`password` on **every hop** — `assertPublicHttpUrl` never looks at those fields, so that is the only place it can be caught for both callers.
  - **`proxy-feed` and `verify-feed-url` strike different bargains — don't collapse them.** `verify-feed-url` returns *no bytes*; `proxy-feed` returns *only feed-shaped, size-capped bytes with a forced content-type*. Both are allowlist-free, and both rely on `_utils/safeFetch.ts` for the per-hop SSRF check.
- `verify-feed-url.ts` - Reachability check for a user-supplied feed URL. `GET ?url=` → `{ reachable, status?, looksLikeFeed?, finalUrl?, reason? }`. **Deliberately has no domain allowlist**, because the musicians who need checking are exactly the ones self-hosting on a domain no list would cover. It can safely drop the allowlist only because it returns a *verdict and never the bytes* — a test asserts the body is never echoed. **Never make this endpoint return response content**; that turns it into an open SSRF proxy. Rate-limited 30/hour per IP. The handler itself is thin: validation, rate limit, then `probeFeedUrl()`. All fetching lives in `_utils/feedProbe.ts` below.
- `_utils/safeFetch.ts` - The transport shared by `/api/verify-feed-url` (via `feedProbe`) and `/api/proxy-feed`: `safeFetchFollow()` walks redirects by hand (`redirect: 'manual'`; **default** max 5, overridable per call via `maxRedirects` — `proxy-feed` passes 10, `feedProbe` keeps the default) re-running `assertPublicHttpUrl` on **every hop** — a first-hop-only check is bypassed by redirecting to `169.254.169.254` — plus `readCapped()` (returns `{ text, truncated }`; a caller that returns bytes must refuse on `truncated`) and `looksLikeFeedText()`. **It makes no policy decisions**: a 503 comes back as `ok: true`, because "we completed a request" is mechanism while "503 means server-error" is policy, and its two callers classify differently on purpose. Don't move a policy decision into it, and don't move the no-bytes rule out of `feedProbe.ts` into it.
- `_utils/feedProbe.ts` - The shared probe, used by both `/api/verify-feed-url` (advisory) and the submit guard, so the warning shown beside a URL field and the refusal on submit can never disagree. Builds on `safeFetch.ts` above, passing `startAlreadyChecked: true` so its two parallel walks share `probeFeedUrl`'s single preflight (that's also what keeps a blocked *first* hop distinguishable from a redirect into one). Sniffs at most 64 KB for `<rss`/`<feed`/`<channel`. 10 s budget for the endpoint, 4 s for the guard (`GUARD_TIMEOUT_MS`), one `AbortController` shared by both probes. The **no-bytes guarantee is this module's alone** — `proxy-feed` shares the transport but not that rule.
  - **The guard's 4 s is coupled to `vercel.json`.** That file sets no `functions.maxDuration`, so these run on Vercel's default, and `/api/pubnotify` already makes up to four sequential Podcast Index calls *after* the guard. A WAF challenge answers instantly — only the fail-open cases are slow, and those fail open anyway — so the short budget costs almost no detection power. If someone raises `GUARD_TIMEOUT_MS` or adds work to `pubnotify`, set `maxDuration` at the same time.
  - **Two probes per check, and any block wins.** A bare GET and a ranged GET (`Range: bytes=0-2047`, so a `206` counts as success) run in parallel; if either returns 401/403/429 the verdict is `blocked`. Bot protection *scores* request shape rather than applying a flat rule, so the same URL answers differently depending on how you ask — measured on `rollzmcguyver.com`, `curl --http1.1` got 200 8/8 while `--http2` got 403 8/8, and Node fetch flipped between 403 and 206 within minutes. One sample is a coin flip; two differently shaped ones, biased toward reporting the block, held at 6/6. **Don't "simplify" this back to a single fetch, and don't make the two probes identical** — the difference in request shape is the point.
  - The machine-readable `ProbeVerdict` rides on the returned *wrapper*, not on `outcome`. `/api/verify-feed-url` serialises `result.outcome` verbatim, so anything added to `FeedProbeOutcome` ships in the public response — which is what keeps the endpoint's JSON stable while the guard gets what it needs.
  - A blocked *redirect target* is `unsafe`, not `blocked`. `blocked` means the origin's WAF refused our crawler; telling a user "your host returned 403" when their feed actually redirects to a private address would send them to fix the wrong thing.
- `_utils/urlSafety.ts` - Shared SSRF guards: `isPrivateHost()` (literal-host string check — **its IPv6 prefix tests are gated on the host actually containing a colon**; `fc00::/7` and `fe80::/10` are matched by string prefix, so an ungated check refuses every public domain starting with those two letters — `fdrecords.com`, `fcmusic.net`, `fcc.gov`, `fdic.gov`. That was invisible while `proxy-feed` had an allowlist, because the check never saw a hostname the allowlist hadn't already vetted, and became a live false positive the moment self-hosted domains were the point. A hostname can never contain a colon, since `URL.hostname` excludes the port, and resolved IPv6 addresses are checked separately in `isPrivateAddress`), `assertPublicHttpUrl()` (protocol + `isPrivateHost` + **DNS resolution** check — the resolution step is what stops an attacker pointing their own public hostname at cloud metadata, and it's load-bearing for `feedProbe` which has no allowlist behind it), and `getClientIp()`. An earlier draft of the submit guard carried a parallel `_utils/httpGuards.ts` with its own `isPrivateHost`; that file was dropped before #93 merged, because it did the literal-host check **without** the DNS step. If you find it referenced in old branches or PR history, this file is the replacement.
- **Security invariants added in the hardening pass** (don't quietly undo these):
  - `GET /api/hosted/{id}.xml` sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. It serves user-supplied bytes from MSP's own origin — the origin whose `localStorage` holds every hosted feed's edit token and the email session JWT. `proxy-feed`'s guard 5 already reasons about exactly this ("passing through `text/html` would be stored XSS on our own origin"); the reasoning hadn't been carried across. The CSP is what stops an `<?xml-stylesheet?>` in one hosted feed pulling XSLT from another and executing script in our origin. Neither header affects podcast apps or Podcast Index — they aren't browsers.
  - `getVerifyOrigin()` (`api/auth/magic-link.ts`) accepts the `*.vercel.app` suffix **only when `VERCEL_ENV !== 'production'`**. Anyone can register a Vercel project, so accepting that suffix in production made the emailed link's host attacker-selectable via `X-Forwarded-Host` — a genuine MSP email carrying a valid single-use token pointed at their site. Whether Vercel overwrites that header is a platform property; this must not depend on the answer.
  - `api/feed/[npub]/[guid].ts` validates the resolved pointer is `http(s)` before redirecting. The URL comes from a kind-1063 event under a caller-supplied npub, so it's fully attacker-controlled. Residual, accepted: an attacker can still point their own pointer at their own https site, so an MSP link can land on a page they control. Closing that means proxying the bytes, which trades phishing for SSRF.
  - `MSP_ADMIN_KEY` is compared with `timingSafeEqualString()`, not `===`. Note it is **not** `timingSafeEqualHex` — that does `Buffer.from(x, 'hex')`, which silently truncates non-hex input, so `'zz'` and `'zq'` both become an empty buffer and compare **equal**. Free-form secrets must use the string variant.
  - `feedHydrate` strips `editTokenHash` from its return. `ownerEmailHash` is deliberately kept — `ImportModal` reads it to detect email linkage — but the admin listing does expose other people's, which is worth revisiting.
  - `escapeXml` is applied at **every** interpolation in `xmlGenerator.ts`, attribute values included. Five were missing (`language`, `podcast:medium`, `suggested=`, `length=`, `itunes:duration`), all reachable from an imported third-party feed that MSP then hosts. `podcast:medium` is the instructive one: it's typed as a union but the parser produces it with a **cast, not a validation**, so the type says nothing about the value.
- `_utils/feedReachability.ts` - The submit guard: `guardFeedSubmission()`, `wantsForce()`, `isMspHostedUrl()`. See "Feed URL whitespace & reachability" below.
- `_utils/feedCorpus.network.test.ts` - **Run this before and after touching any fetch guard.** Every other test in the repo mocks `fetch`, which is what makes them fast and also what makes them structurally unable to catch the failure that matters most here: a guard refusing a feed that is actually fine. The 17-domain allowlist passed its entire mocked suite while 403ing every self-hosted musician in the world, and three more guards (the `fc`/`fd` over-match, the over-ceiling body cap, the 5-redirect limit) shipped the same way. This file points the **real** guard constants — imported from `proxy-feed.ts`, not restated — at **real** feeds: the ones from #99, Fountain's, a redirecting host, and an 18 MB feed that documents the cap. Network-dependent, so it is opt-in and `npm test` stays hermetic:
  ```
  MSP_FEED_CORPUS=1 npx vitest run api/_utils/feedCorpus.network.test.ts
  ```
  A failure is not automatically a code bug — a musician's host may just be down. Read the printed table before believing it. Tightening a constant in `proxy-feed.ts` fails here rather than silently shrinking what MSP can import.
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `boosts/ingest.ts` - Receives Helipad boost records (webhook or import batch). See "Boost capture" below
- `boosts/coverage.ts` - Admin-only aggregate report over the derived boost projection. Counts only — it must never return a raw record
- `_utils/boostRecord.ts` - Parsing, the track-resolution ladder, and the PII boundary (`toDerived`)
- `_utils/boostStore.ts` - Blob paths, raw writes, derived week merge
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)
- `_utils/podcastIndex.ts` - Shared Podcast Index auth headers
- `_utils/feedUtils.ts` - Shared feed utilities (PI notification, podping notification, `isPodpingConfigured()` helper, UUID validation, token hashing)
- `_utils/rateLimiter.ts` - In-memory fixed-window rate limiter over a **single shared `Map`**, so every caller must namespace its key or two endpoints silently share one bucket. Current consumers: `/api/podping` (`podping:`, 10/hr), `/api/verify-feed-url` (`verify-feed-url:`, 30/hr), `/api/proxy-feed` (`proxy-feed:`, 60/hr), `/api/podping-verify` (`podping-verify:`, 60/hr), `guardFeedSubmission()` (`feed-guard:`, 60/hr), `/api/auth/magic-link` (`magiclink:ip:` + `magiclink:email:`, 5 per 15 min), `/api/boosts/ingest` (`boost-ingest:`, 600/hr). **Always prefix a new key.** An unprefixed `checkRateLimit(ip, …)` shares a bucket with every other unprefixed caller, and the symptom — one endpoint's limit tripping because of traffic to a different one — looks nothing like its cause.
  - **Every limit is per warm lambda, not global.** The `Map` is module-level, so each Vercel instance keeps its own buckets and a caller with concurrency gets N× the nominal rate. Accepted — the limits exist to stop casual abuse and runaway loops, not a determined attacker — but don't cite these numbers as a security control. A real limit needs shared state (Redis/Edge Config).
  - Endpoints with **no** limit at all: `POST /api/hosted` (unauthenticated, 1 MB blob write + PI submit + podping), `GET /api/hosted/`, `PUT/DELETE/PATCH /api/hosted/{id}`, `/api/pisearch`, `/api/pisubmit`, `/api/pubnotify` (all three spend MSP's PI credentials), `/api/auth/verify`, `/api/account/feeds`, `/api/feed/{npub}/{guid}` (opens 4 relay sockets), `GET /api/boosts/coverage` (admin-gated, but reads every derived blob).
- `_utils/xmlUtils.ts` - RSS XML helpers (`extractPodcastMedium()` — used by hosted POST/PUT before podping broadcast)
- `_utils/adminAuth.ts` - Nostr NIP-98 auth verification, `NostrEvent` type
- `_utils/urlValidation.ts` - `normalizeFeedUrl()` + `getFeedUrlError()`. Mirror of `src/utils/urlValidation.ts` (Vercel functions can't import from `src/`, so the rule table is intentionally duplicated). The `src/api mirror` test in `api/_utils/urlValidation.test.ts` asserts the two files are byte-identical apart from the api copy's 2-line header — **edit one, copy it to the other, or that test fails**. See "Feed URL whitespace & reachability" below for the full contract.

### Feed URL whitespace & reachability

Two separate problems with a pasted feed URL, handled differently on purpose.

**Edge whitespace is stripped, interior whitespace is an error.** `normalizeFeedUrl()` trims leading/trailing spaces, tabs, newlines, NBSP, C0 controls and zero-width/BOM characters. Interior whitespace is deliberately *preserved* by the normalizer and *rejected* by `getFeedUrlError()`, because deleting it would submit a different URL than the user has and `%20`-encoding it would be a guess about the real filename — so the error tells the user to **rename the file at the host**, not to edit the text box.
- `getFeedUrlError()` calls `normalizeFeedUrl()` internally. That's the robustness guarantee: a call site that forgets to normalize still can't produce a false "contains whitespace" error for a paste.
- The whitespace rule is `/\s/`, not `includes(' ')`. Tabs and newlines matter as much as spaces because **`new URL()` silently deletes interior tab/LF/CR** — before this, a URL with an embedded newline passed every check and Podcast Index was handed a URL the user never typed.
- The apostrophe rule matches every apostrophe-*shaped* character, not just the ASCII `'`: `’` U+2019 and `‘` U+2018 (a smart-quoting CMS produces the latter for a leading elision — `'Round Midnight`), `ʼ` U+02BC and `ʻ` U+02BB (Uzbek/Cherokee, and the Hawaiian okina in `Hawaiʻi`), and `＇` U+FF07 from a CJK IME. None of these changes *whether* a URL is refused — they are all non-ASCII, so the last rule already caught them. It changes which message is shown: the *detail* comes from the first matching rule, so ordering (whitespace → apostrophes → special chars → non-ASCII) is what earns the user the duplicate-feed explanation instead of the generic "may cause indexing issues".
- **A pre-encoded `%27` is deliberately not matched.** It is the form Podcast Index itself stores and hands back, it fetches fine, and this table is a hard **400** on `/api/pisubmit`, `/api/pubnotify`, `/api/podping`, `/api/podping-verify` and `/api/verify-feed-url` — so matching it refuses working feeds and leaves the user unable to run even a reachability check. `getFeedUrlError` is not advisory; anything added here blocks. Warn about the character the user can fix by renaming, never about the encoding that already works.
- Normalize at the point a URL **enters component state** (the `onChange` handler), not on paste or blur: `onPaste` misses typed whitespace, autofill and every programmatic path, and `onBlur` runs after the inline error and the debounced PI lookups have already fired. Trimming only the ends means the caret never jumps during mid-string editing.
- Backends re-normalize as defense in depth. Each handler destructures as `url: rawUrl` and rebinds `const url = normalizeFeedUrl(rawUrl)` right after the type guard, so no downstream use can be missed. `notifyPodping()` and `notifyPodcastIndex()` normalize too, which covers the hosted POST/PUT paths that never touch an `/api` handler.

**A clean URL still isn't necessarily a correct one.** Trimming makes a URL *plausible*; it doesn't mean anything is published there. If the file really is called `my feed.xml`, then trimming — or the user just deleting the space to get past the validator — yields a URL that 404s, and a broken entry in Podcast Index is worse than a rejected submission because PI keeps it. Worse still is a feed behind Cloudflare Bot Fight Mode: it registers fine, PI's crawler gets a 403, and the feed sits in the index with `lastGoodHttpStatusTime: 0` forever while MSP reports "✅ Submitted!" (the `rollzmcguyver.com` case). Reachability is checked in **two layers**, on purpose.

**Layer 1 — the client advisory (`src/utils/verifyFeedUrl.ts` → `/api/verify-feed-url`).**
- **Advisory, never blocking.** A failed check sets a warning and a `bypassVerify` latch that relabels the button to "Submit anyway"; a second click submits. Reachability is a heuristic — a slow origin, a Cloudflare challenge or a host that dislikes our user-agent are all false negatives, and hard-blocking would strand a user with a perfectly good feed.
- **Our own outage is never the user's problem**: `verifyFeedUrl()` resolves `ok: true` on a network failure, a non-200 from our endpoint, or unparseable JSON. Only positive evidence (a 404, a non-feed body, a refused address) produces a warning. Same principle as `/api/podping-verify` returning 502 rather than `landed:false` when no Hive node answers.
- Reset both `verifyWarning` and `bypassVerify` in the URL's `onChange` — a warning and the permission to ignore it belong to the URL that earned them.

Wired into all six manual feed-URL inputs that reach PI or podping: `SaveModal` (Submit to PodcastIndex mode), `PodpingModal`, `Editor` publisher-URL field, `PublisherFeedReminderSection`, `CatalogFeedsSection`, `DownloadCatalogSection`.

**Layer 2 — the server submit guard (`guardFeedSubmission()` in `api/_utils/feedReachability.ts`).** Runs inline in `/api/pubnotify`, `/api/pisubmit` and `/api/podping` — the same three chokepoints where `getFeedUrlError()` is enforced, and for the same reason: a per-input UI check covers six of the nine client submit paths, but the other three are **automatic** (`publisherPublish.ts`, SaveModal's nsite follow-up, `PublisherFeedReminderSection`'s post-hosting ping) where nobody types a URL and there is no field to warn beside. One guard at the API layer covers all of them, including any added later. Rules, all load-bearing:
- **Refuses only on `verdict === 'blocked'`** (401/403/429). Timeout, DNS failure, 5xx, HTML-instead-of-RSS, an unsafe redirect — everything else **fails open**. Our probe being wrong, or Vercel's egress being unhappy, must never stop someone submitting a feed that is actually fine.
- **`force` bypasses it entirely** (`?force=1` / `{ force: true }`, parsed by `wantsForce()`). On the client the **existing `bypassVerify` latch is the override** — it already relabels the button and already resets on `onChange`, so `force` is just `bypassVerify` sent over the wire. Don't add a parallel refusal state; two sources of truth for "the user insisted" will drift.
- **A server refusal arms that same latch.** `isGuardRefusal(data)` (structural check, not string-matching, in `src/utils/verifyFeedUrl.ts`) on a 400 → show `data.error` and set `bypassVerify`, so the next click forces. Without this the second click would hit the guard again and the user is trapped.
- **MSP-hosted URLs skip the probe** (`isMspHostedUrl()`) — we serve those. It matches the `/api/hosted/` **path** as well as the two known hosts, because `buildHostedUrl` derives its origin from `VITE_CANONICAL_URL` and a preview deploy would otherwise have MSP probing itself on every hosted save.
- **An overridden submit never reports clean success.** All six sites append `FORCED_SUBMIT_NOTE` instead of a bare ✅, so the override can't recreate the exact false positive the guard exists to stop. This also fires when the latch came from a 404 warning rather than a block — correct, and one rule beats two.
- **A fail-open probe budget** (`feed-guard:<ip>`, 60/hour). `pubnotify`/`pisubmit` have no rate limit of their own, and the guard turns them into an unauthenticated "fetch any public URL and tell me what happened" service. Exhaustion **skips the probe** rather than refusing.
- Refusal shape is `{ error, reachability }` at HTTP 400. `GuardRefusal` is duplicated frontend-side (can't import from `api/`, same arrangement as `urlValidation.ts`) — keep in sync.
- Endpoint tests neutralize the guard via a hoisted `vi.mock` of `./_utils/feedReachability.js`, or it consumes their mocked `fetch` queues and makes live DNS calls. Its real behaviour is covered in `api/_utils/feedReachability.test.ts`.

**A new manual feed-URL input that submits to PI/podping needs all five pieces**: `normalizeFeedUrl` in `onChange`, a `getFeedUrlError` check gating the submit button, a `verifyFeedUrl` pre-flight with the "Submit anyway" latch, `force` + `isGuardRefusal` handling wired to that same latch, and `normalizeFeedUrl` again at the send site (state can arrive from an import that never passed through `onChange`).

`DownloadCatalogSection` used to force its PI re-check by appending a space to `publisherFeedUrl` and trimming it back a tick later. That string is stamped into every catalog feed's `<podcast:publisher>` tag, so it must never carry whitespace even momentarily — the re-check is now a `piCheckNonce` counter in the lookup effect's deps. Don't add that nonce to the auto-populate effect; it would restart the polling interval.

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- **A missing `.meta.json` is a refusal, never a migration path.** The meta blob holds the only stored credential (`editTokenHash`, plus any `ownerPubkey`/`ownerEmailHash`), so without it there is *nothing to check a caller against* — and `feedId` is the `podcastGuid`, published in the feed's own `<podcast:guid>` and in the URL registered with Podcast Index, so it is not a secret. Three paths used to treat "no metadata" as "no owner" and let the caller become one: PUT accepted **any** `X-Edit-Token` and adopted its hash; DELETE accepted any non-empty token (`X-Edit-Token: x` deleted the feed); and POST deduplicated on the meta blob alone, then wrote the XML with `allowOverwrite: true`, so an orphaned `.xml` could be claimed anonymously — overwriting the artist's `<podcast:value>` splits and redirecting their payments. All three now return **409**, recovery goes through the admin restore endpoint, and POST checks for the `.xml` blob as well as the meta blob with `allowOverwrite: false`. Covered by `api/hosted/feedId-takeover.test.ts` and `api/hosted/index-create-guard.test.ts`; four of those tests fail against the old behaviour. **Don't reintroduce a "legacy feed" write path** — an owner who can't be distinguished from an attacker can't be authorized.
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **PI registration is asynchronous — no feed id at save time does NOT mean rejection.** `add/byfeedurl` *queues* the URL; PI only mints a feed record once its crawler actually fetches the feed, measured at ~47 s after the save in one observed case. So the synchronous `add/byfeedurl` call inside a hosted POST/PUT routinely returns **no `feed.id`** for a brand-new feed even though registration succeeds moments later. Never render that as a failure. This was the bug behind "Feed created!" going silent about PI while the feed was in fact indexed
- `notifyPodcastIndex()` returns `{ podcastIndexId: number | null, addResult?: PodcastIndexAddResult }` — `addResult` (`{ httpStatus?, status?, description?, error? }`) is present **only** when no id came back and carries PI's own explanation, mirroring the shape `/api/pubnotify` already returned. Both hosted POST and PUT spread it into their JSON responses (`...(addResult ? { addResult } : {})`). The PUT only reports it when it ends up with no id at all — a feed that already had one keeps it. The meta blob still stores just the numeric id. `PodcastIndexAddResult` is duplicated in `src/utils/hostedFeed.ts` (frontend can't import from `api/`, same arrangement as `urlValidation.ts`) — keep in sync
- **Post-upload confirmation (`SaveModal.tsx`)**: a successful "Host on MSP" upload sets `published: PublishedResult`, which hides the Upload button (`isUploadDone`) and relabels Cancel to **Done**, so the modal doesn't read as "nothing happened, click again". The PI block below the feed URL has three states: ✅ with a `podcastindex.org/podcast/{id}` link; "Submitted — waiting for Podcast Index to fetch your feed" while a follow-up lookup polls `/api/pisearch?q={guid}` (first at 5 s, then every 10 s, 9 attempts ≈ 90 s) and upgrades itself the moment the feed lands; and finally "hasn't picked it up yet" with a **Check again** button and the manual-add link. `published` is cleared by `selectMode()`, the draft-mode checkbox, and Unlink — all three would otherwise strand the user with no Upload button
- **The watch outlives the modal.** `SaveModal`'s poll is cancelled by its own effect cleanup when the modal unmounts, so a feed PI crawls *after* the user clicks Done would leave the toolbar button dark until a page refresh. `SaveModal` therefore calls `onPodcastIndexPending` when a non-draft save comes back without an id, and `App.tsx` picks the watch up (5 s, then every 15 s, 12 attempts ≈ 3 min) — gated on `!showSaveModal` so the two pollers never overlap, and on `!piFeedId` so it stops the moment either finds it. Nothing polls unless a save actually reported the feed as not-yet-indexed
- **The hosted panel also checks on open**, not just after a save: the poll above is keyed on `published`, so a user who closed the modal before PI crawled the feed would reopen it to no PI section at all. A second effect runs one `lookUpPodcastIndex()` when the hosted panel opens on a feed whose id isn't already known (skipped while the poll owns it, or when `hostedInfo.podcastIndexId` is cached). Between that and the toolbar button there should be no state where MSP knows a feed is indexed but doesn't say so — worth preserving when touching this area
- **`podcastIndexId` is cached in `HostedFeedInfo`** (`src/utils/storage.ts`) and seeded into the toolbar's PI button ahead of the `/api/pisearch` fallback in `App.tsx`. Load-bearing: that search matches on **podcastGuid**, which PI only knows *after* crawling the feed, so a freshly registered feed is invisible to it. `SaveModal` also reports the id upward via `onPodcastIndexId` so the button lights up without a reload
- **Manual PI submission**: the SaveModal's "Submit to PodcastIndex" destination and `PublisherFeedReminderSection` (self-hosted URL field) both call `/api/pubnotify` for feeds not hosted on MSP. The previous standalone `PodcastIndexModal` toolbar button was folded into the SaveModal dropdown — there is no longer a separate top-level modal.
- `pubnotify.ts` does pubnotify ping, GUID/URL lookup, then `add/byfeedurl` for new feeds — returns PI page URL for immediate user feedback
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed
- **Podping**: `notifyPodcastIndex()` fire-and-forgets `notifyPodping()` after the PI pubnotify ping. Sends `GET ${PODPING_ENDPOINT_URL}?url=...` with `Authorization: Bearer ${PODPING_BEARER_TOKEN}`. The endpoint is MSP's self-hosted [podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger) deployment on Railway (repo: `ChadFarrow/msp-podping-service`), fronted by a Caddy sidecar enforcing the bearer token. Silently no-ops when either env var is unset (`isPodpingConfigured()` in `api/_utils/feedUtils.ts` is the canonical gate). The fire-and-forget call site uses a `.then()` that `console.warn`s on failure so Vercel function logs surface hivepinger outages. `/api/podping` exposes a manual endpoint behind a 10/hour per-IP rate limit. `/api/pubnotify` also fires a podping (same fire-and-forget pattern) so the "Podcast Index" toolbar button hits both indexing pathways. UI entry point for a pure podping (no PI call): the standalone **Podping** button on the bottom toolbar (`PodpingModal.tsx` — opens a mini modal with just a URL field + submit, `reason` is hardcoded to `'update'`). A 200 from `/api/podping` only means hivepinger **queued** the ping — the Hive broadcast is asynchronous — so after a successful send the modal polls `/api/podping-verify` (first at 3 s, then every 5 s, 6 attempts max, passing `since` = send time) and reports "✅ Podping received", "Not received yet — it may still be queued", or "Couldn't check Hive right now". Deliberately no block number or explorer link — the tx details are in the API response for debugging but musicians don't need them (and `hiveblocks.com` has been unreliable). Polling is aborted on close/URL-edit/resend. **Only this manual path verifies on-chain landing** — the auto-fire podpings (hosted POST/PUT, `/api/pubnotify`) remain fire-and-forget with failures visible only in Vercel logs.
- **A successful podping does not mean the feed will index.** Podping only tells indexers to go look; if the feed's own host then answers their crawler with a 403 (Cloudflare Bot Fight Mode is the common culprit on WordPress sites), the feed registers in PI with `lastGoodHttpStatusTime: 0` and stays permanently blank. `/api/podping` therefore runs the submit guard (see "Feed URL whitespace & reachability") and refuses a confirmed block, with "Send anyway" as the override. When a user reports "I podpinged and nothing showed up", check `podcasts/byfeedurl` for `lastHttpStatus` before looking at anything in MSP.
- **Podping retries — MSP has none, by design**: `notifyPodping()` is a single `fetch` with no retry or backoff; a failed send surfaces its status and stops (the user clicks the button again). The verify polling retries the *check*, never the send — a "Not received yet" result never re-sends. Hivepinger owns queue + dedup + Hive-broadcast retries, which is why MSP doesn't duplicate them. Don't confuse this with the `msp-podping-service` **consumer**'s "retry ×2 with 2s/8s backoff" — that governs fetching feeds into stablekraft-app *after* a podping is seen on Hive, a different layer entirely. Known edge from hivepinger's dedup: re-sending a ping for a feed that was pinged moments ago writes no new op, so the `since` cutoff reports "Not received yet" even though the earlier ping landed. That's the deliberate tradeoff for eliminating the false positive (see `since` above) — prefer a missed confirmation over a fabricated one. The SaveModal previously had a "Send Podping" destination; it was removed in favor of the dedicated toolbar button.
- **Podping `medium` — load-bearing**: hivepinger uses the `medium` value to build the custom_json op id as `pp_<medium>_<reason>` (e.g. `pp_music_update`). The companion consumer in `msp-podping-service` filters `pp_music_*` only, so any code path that fires a podping WITHOUT a medium ends up as `pp_podcast_update` (hivepinger's default) and is invisible to the consumer. Every client path that can trigger a podping passes medium: hosted POST/PUT (extracted via `extractPodcastMedium()` from the XML), SaveModal's nsite follow-up and "Submit to PodcastIndex" destination (`album.medium` / `publisherFeed.medium`), `publisherPublish.ts`'s internal `notifyPodcastIndex()` helper (takes a `medium` param forwarded to `/api/pubnotify`), PublisherFeedReminderSection (`publisherFeed.medium`). The PodpingModal toolbar button reads medium from the feed (`album.medium` / `videoFeed.medium` / `publisherFeed.medium`), matching the SaveModal pattern. Publisher feeds carry `medium: 'publisher'` which produces `pp_publisher_update` — still filtered out by the music-only consumer, preserving the prior intent without special-casing. When adding a new podping trigger, always plumb through the feed's medium — the `isPodpingConfigured()` gate + `notifyPodping(url, { medium })` signature is the canonical call site pattern.

### Boost capture (Helipad → MSP)

Every feed MSP generates carries a 1% `MSP 2.0` recipient
(`COMMUNITY_SUPPORT_RECIPIENTS` in `src/types/feed.ts`), so the splits land on Chad's
node and Helipad sees them. This subsystem captures those records so a **music chart**
can be built from them later — a weekly Top 10 of what people actually boosted. It is
not a revenue dashboard, and phase 1 deliberately displays nothing publicly.

**Phase 1 answers one question: what share of boosts can be resolved to a real track,
and by which signal?** `/admin` renders that as a table (`BoostCoverage.tsx`). Read it
before designing anything on top — if most boosts land on `message` or `none`, a Top 10
needs `valueTimeSplit` resolution or Podcast Index lookups first, or it has to be about
shows rather than tracks.

**Helipad facts, verified in `Podcastindex-org/helipad@main`, not assumed:**
- Webhooks are **triggers**. `src/triggers.rs` builds `WebhookEffect { index, url, token }` and sends `Authorization: Bearer <token>`. There is no HMAC and no signature — the bearer token is the whole of the authentication.
- The payload is `WebhookPayload { direction, ..BoostRecord }`, i.e. `direction` plus a flattened boost record.
- **`tlv` is a JSON *string*, not an object**, and its contents are written by the boosting app. Two real captures share barely half their keys, so every field inside is optional and a parse failure must not lose the boost.
- **`action` exists twice with two types** — a number in the outer body (Helipad's `ActionType`) and a string inside the TLV (the app's word). `parseBoostPayload` prefers the number and falls back to the TLV word for values the README doesn't document, rather than inventing a mapping.
- **A delivery counts as successful only on HTTP exactly `200`** (`let successful = status == 200`). Not 201, not 204.
- **Helipad never retries.** A non-200 loses that boost from the webhook path permanently. That is why `tools/import-helipad.mjs` is a standing repair tool, not a one-off.
- Redirects are capped at 5, so point the trigger at the canonical host.
- Trigger filters cover amount, sender, app and podcast — **not** the TLV `name`, so the "is this an MSP split" test (`isMspSplit()`) must live on MSP's side.
- **Do not backfill from `/csv`.** Its columns carry no `tlv`, no `url`, no `guid` and no recipient `name`, so a CSV import can neither join a boost to a feed nor tell an MSP split from a boost to one of Chad's own shows. `/api/v1/boosts` returns the same `BoostRecord` the webhook sends and is full fidelity.

**The privacy boundary is `toDerived()`, and it is the only one.** Raw records are
stored verbatim — listener message, sender name and sender id included — because the
song title frequently appears *only* in the free-text message, and discarding it at
ingest would delete exactly what a Top 10 needs. Nothing serves a raw record. The
derived projection carries no listener field at all, and a test in
`boostRecord.test.ts` asserts that by serializing it and searching for them. Keep that
test honest when adding a field.

**Track resolution is a ladder, best rung first**, and which rung answered is recorded
on every record as `trackSource`:
`remote-guid` (canonical `podcast:remoteItem` pair) → `remote-title` (Helipad resolved
the guids for us) → `boost-link` (an app's own stable song URL) → `timesplit` → `message`
→ `none`. Two rules are load-bearing:
- **`timesplit` returns no `trackKey`.** A playback offset is a pointer to resolve later
  against the show's `valueTimeSplit`s, not an identity. Keying on it would make two
  boosts seconds apart look like different tracks.
- **A message-scraped title enriches the higher rungs.** `boost-link` gives a stable key
  but no human-readable name, so it takes its title from the message. The rungs pick the
  *key*; the title comes from the best source available.

**Storage** is Vercel Blob, following the `accountStore.ts` "unguessable path" pattern:
`boosts/raw/<MSP_BOOST_NAMESPACE>/<YYYY-MM>/<direction>-<index>.json` (private, verbatim)
and `boosts/derived/<isoYear>-W<week>.json` (PII-free, weekly because that is the unit
the chart reports in). Dedup is the raw path itself — `index` is unique per node and the
write uses `allowOverwrite: false`. **The derived merge runs for every record in a batch
whether or not its raw blob already existed**, which is what makes re-running the import
script repair a lost derived write *and* re-derive history through an improved
`resolveTrack()` without touching the store.

**Committed tooling lives in `tools/`, not `scripts/`.** `.gitignore` ignores `scripts/`
entirely — it is Chad's local scratch and feed-backup directory, and a script written
there is silently never committed. That is where `tools/import-helipad.mjs` would have
landed by convention, and it would have looked committed while being invisible to CI,
to Vercel, and to the Desktop App fork.

**Re-running `tools/import-helipad.mjs` is always safe** and is the answer to most
operational problems here: a missed webhook, a lost derived write, or a resolver
improvement that should be applied to history.

### Save Modal Destinations
The Save modal (`src/components/modals/SaveModal.tsx`) offers nine destinations. Each is a different combination of *where the bytes live* and *who can consume them* — important context when deciding which one to point a user at:

| Destination | What gets published | Storage | Subscribable in podcast apps? |
|---|---|---|---|
| Local Storage | Album/Video/Publisher state | Browser localStorage | No |
| Download XML | Generated RSS XML | User's filesystem | No |
| Copy to Clipboard | Generated RSS XML | Clipboard | No |
| Host on MSP | Generated RSS XML | Vercel Blob (`feeds/{feedId}.xml`) | Yes — `https://musicsideproject.com/api/hosted/{feedId}.xml` |
| Submit to PodcastIndex | Feed URL (not the bytes) submitted to PI via `/api/pubnotify` | — (registration only) | Indirectly — PI indexes the URL so apps like Fountain/Castamatic can discover it |
| Save RSS feed to Nostr | Full RSS XML embedded in a kind 30054 event | Nostr relays only | No — only MSP reads kind 30054 (cross-device sync) |
| Publish to Nostr Music | Per-track events (kind 36787) + playlist event (kind 34139) | Nostr relays | No — Nostr-native music apps only (e.g. Sunami). Wavlake/Fountain are PC 2.0 apps with Nostr but do NOT play Nostr-native music. Audio files must already be hosted elsewhere; the events just reference enclosure URLs |
| Publish RSS feed to a Blossom server | Generated RSS XML | Blossom server (content-addressed) + kind 1063 NIP-94 pointer event on Nostr | Yes — `${origin}/api/feed/{npub}/{podcastGuid}.xml` resolves the pointer and 302s to the latest Blossom URL |
| Publish RSS feed to nsite | Generated RSS XML | Blossom server + NIP-5A site manifest (kind 35128) | Yes — via any nsite gateway URL |

Login-gated options (everything from "Save RSS feed to Nostr" down) are conditionally rendered on `isLoggedIn` — they don't appear in the dropdown for logged-out users. The help popup (ℹ️ next to the modal title) lists all nine with the same wording so help and dropdown stay in sync — keep them aligned when adding/renaming destinations. Podping has its own dedicated bottom-toolbar button (`PodpingModal.tsx`) and is no longer a SaveModal destination. "Submit to PodcastIndex" handles manual PI submission directly in the SaveModal — the previous standalone toolbar button (`PodcastIndexModal`) has been removed.

**Destination picker is a custom dropdown (not a native `<select>`)**: a native `<option>` can only hold one line of plain text, so to show a short description under each destination label the picker is a custom dropdown built in `SaveModal.tsx`. The destinations are defined once in the module-level `SAVE_DESTINATIONS` array (`{ value, label, blurb, experimental? }`) — the single source of truth for the dropdown rows (`label` + muted `blurb` + a ✓ on the selected one); the ℹ️ help-popup `<li>` list still carries the richer/conditional wording and must be kept in sync by hand. Visibility is computed by `isDestinationVisible()` (same `isLoggedIn`/`isPublisherMode`/`showExperimental` gating as before). The open menu is **portaled to `document.body`** with `position: fixed` (measured from the trigger via `getBoundingClientRect()` in `openDestMenu`) so it escapes the modal's `overflow` clipping — the same pattern `InfoIcon` uses; `z-index: 1100` sits above `.modal-overlay` (1000). It flips above the trigger when there's more room there and caps `max-height` (~340px) so it scrolls internally instead of sprawling past the viewport. The outside-click + scroll-to-close handler **ignores scrolls originating inside the menu** (capture-phase listener), otherwise scrolling the option list would close it. Styles are the `.save-dest*` classes in `App.css`. When adding a destination, add it to `SAVE_DESTINATIONS` (not a hand-written `<option>`) and to the help-popup list.

Most experimental/power-user options are additionally gated behind a "Show Experimental Features" toggle in the hamburger menu (`src/store/experimentalStore.tsx`, localStorage key `msp-show-experimental`, default off). With the toggle off, the Save modal dropdown collapses to the production-ready set: Local Storage, Download XML, Copy to Clipboard, Host on MSP, Submit to PodcastIndex, and (when logged in) Publish to Nostr Music. The Import modal applies the same gate to "Nostr Event" and "From Nostr." When adding a new experimental destination/import source: gate it with `showExperimental` from `useExperimental()`, suffix the visible label with a trailing ` 🧪` marker, sort it to the bottom of its dropdown and help-list (after all non-experimental options), and add a mode-reset `useEffect` so the dropdown snaps back to a safe default if the user flips the toggle off mid-flow. The experimental store follows the same Provider+`useX()`-in-one-file pattern as the other stores (`themeStore`, `feedStore`, `nostrStore`); `eslint.config.js` carves out `react-refresh/only-export-components` for `src/store/*.{ts,tsx}` since these are plumbing files, not fast-refresh-sensitive UI.

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements, detects and strips OP3 prefixes on import
- `fetchFeedFromUrl()` (in `xmlParser.ts`) - How the browser gets a feed's bytes; used by Import-from-URL, the publisher Download Feed buttons and `publisherPublish.ts`. **Exactly one attempt is authoritative for the error.** The direct fetch is a pure optimisation (works only when the host sends CORS headers) and its failure is a bare `TypeError` that says nothing about the feed, so it never produces the user-facing message; `/api/proxy-feed`'s structured `{ error, code, status }` does, mapped through `CODE_MESSAGES` with a fallback to the server's own `error` string so a code added server-side degrades to something usable. Throws `FeedFetchError` carrying `code`/`status`. It used to loop over four transports — direct, our proxy, `allorigins.win`, `corsproxy.io` — `continue`ing past every failure, so the only thing it could report was a generic "paste the XML content directly", which is what made the allowlist 403 undiagnosable. **Don't reintroduce a third-party CORS proxy**: they leak every user's feed URL, corsproxy.io needs an API key, and allorigins wraps the body in JSON that was unwrapped heuristically. A test asserts no fetch URL ever leaves MSP.
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML, applies OP3 prefix to enclosure URLs when enabled

#### Publisher `sourceUrl` (auto-filled Publisher Feed URL)
`PublisherFeed.sourceUrl` is what auto-fills the "Publisher Feed URL" field in the Download Catalog section, which is the URL written into each catalog feed's `<podcast:publisher>` tag. Resolution order, highest first: the URL the feed was actually imported from (set in `handleImport`, only present for URL / "My Hosted Feeds" imports) → the feed's own `<atom:link rel="self">` (read by `parseSelfLink()` in `xmlParser.ts`, which covers file/paste imports) → an MSP hosted URL looked up by `podcastGuid`. Empty is a legitimate outcome for a self-hosted feed with no self-link — the field stays blank with a warning rather than guessing. `parseSelfLink` deliberately does **not** add `atom:link` to `KNOWN_CHANNEL_KEYS`, so the element still round-trips through `unknownChannelElements`. Template imports (`regenerateGuids`) `delete` the parsed `sourceUrl` — a template is a new feed and must not inherit the source's URL.

#### `<podcast:publisher>` nesting and round-trip safety
The spec requires `<podcast:publisher>` to **contain exactly one** `<podcast:remoteItem medium="publisher">`, and that is what `generatePublisherXml()` (`xmlGenerator.ts`) emits. A publisher *feed*'s own catalog listing is the opposite shape — bare channel-level `remoteItem`s, no wrapper. The asymmetry is correct, not a bug; it has been reported as one. The generator test asserts the **whole nested block** rather than independent `toContain` substrings, because separate checks would pass with an empty `<podcast:publisher></podcast:publisher>` and the `remoteItem` emitted as a sibling — precisely the shape the false report claimed.

Anything the parser doesn't read but *does* list in `KNOWN_CHANNEL_KEYS` is **deleted**, not preserved, because the key is what excludes it from `unknownChannelElements`. That matters because Download Feed / `processCatalogFeed` are parse→regenerate over someone else's album feed. Two consequences, both now handled:
- `parsePublisherReference()` reads three shapes, normalizing all of them to the canonical one on output: the nested form; **attributes written directly on `<podcast:publisher>`** (out of spec but occurs in the wild); and **repeated `remoteItem` children** — fast-xml-parser returns an array there and `getAttr` yields `''` for an array, which used to drop the publisher entirely.
- `ALBUM_CHANNEL_KEYS` is `KNOWN_CHANNEL_KEYS` minus `podcast:remoteItem`, used at the two album call sites only. Album feeds don't model a channel-level podroll, so dropping the key lets it round-trip as an unknown element instead of being eaten. The publisher path keeps the full set — it parses those into `feed.remoteItems` and would otherwise emit them twice. **Adding a key to `KNOWN_CHANNEL_KEYS` without also parsing it is how data gets silently destroyed here.**
- **The mirror-image hazard: passing an element through that the generator also writes.** Some feeds point at their publisher with a bare channel-level `<podcast:remoteItem medium="publisher">` and no wrapper. Once `ALBUM_CHANNEL_KEYS` stopped eating that key, the bare ref survived as an unknown element — and `DownloadCatalogSection` (both handlers) and `processCatalogFeed` overwrite `album.publisher` **unconditionally** right after parsing, so the regenerated file carried the passed-through ref *and* a generated `<podcast:publisher>` block. Two publisher references in a file MSP rewrote on the user's behalf. So `parseRssFeed` **consumes** the publisher-medium entry into `album.publisher` and removes just that entry from `unknownChannelElements`, leaving other mediums (the real podroll) to round-trip. The rule for this file: an element is either modelled or passed through, never both — and "known key, unparsed" and "unknown key, also generated" are the two ways to get it wrong.

#### Track lyrics (`<podcast:transcript>`)
Track-level only, surfaced as "Lyrics URL" in the editor. `TRANSCRIPT_TYPES` in `types/feed.ts` is the single source of truth for the type dropdown and carries the spec's five MIME types. Note `DEFAULT_TRANSCRIPT_TYPE` is `application/x-subrip` — the spec's name for SubRip. MSP wrote the non-spec `application/srt` for a long time; the default and the *missing-attribute fallback* both changed, but nothing rewrites a type a feed states explicitly, and the dropdown renders an unrecognized value as its own option rather than snapping it to SubRip. Multiple `<podcast:transcript>` per item (several languages) is still lossy — `getAttr` reads one node.

#### `<podcast:remoteItem>` title is an attribute, not element text
The spec defines `title` as an **attribute** on a **self-closing** element — "a hint to apps so that they can display the title without having to do a remote lookup." MSP wrote it as element text (`<podcast:remoteItem …>Please Stand By</podcast:remoteItem>`) and read it back the same way, so the two halves agreed with each other and with nobody else: the hint reached no conforming reader, and **every spec-conformant publisher feed imported with no titles at all** — Fountain's included, where all three album titles came through empty. `parseRemoteItem` now reads the attribute first and falls back to element text (for feeds MSP itself wrote before this), and `generateRemoteItemXml` always emits the attribute form. Legacy feeds are upgraded to the spec form on the next save.

Two more conformance gaps found the same way, both in the generator, both affecting **every feed MSP has ever produced**:
- **`<link>` inside `<image>` is required by RSS 2.0** (url + title + link). MSP emitted it only when the optional `imageLink` field was filled in, so the W3C validator failed MSP feeds with `MissingLink` — an **error**, not a warning. It now falls back to the channel `<link>`, which is the conventional value.
- **`<atom:link rel="self">` was never emitted.** Not required by RSS 2.0, but the validator warns (`MissingAtomSelfLink`), and it costs MSP directly: `parseSelfLink()` is one of the three sources for the Publisher Feed URL that auto-fills the Download Catalog field, so a self-hosted feed re-imported from a file had nothing to fall back on. Publisher feeds now emit it **from `sourceUrl` only** — never a guess — and **only when `unknownChannelElements` doesn't already carry one**, since `atom:link` round-trips through the passthrough and generating a second would duplicate the element. Album/video feeds have no `sourceUrl` equivalent, so they still don't emit one. Verified: regenerating James Goulding's feed takes it from `validity: false, 1 error` to `validity: true, 0 errors`.

`feedImg` is deliberately kept even though it is **not** a spec attribute: `CatalogFeedsSection` and `DownloadCatalogSection` render the catalog thumbnails from `RemoteItem.image`, so dropping it would blank them on the next import. Conforming parsers ignore unknown attributes, so it costs other readers nothing. Don't "clean it up" without moving that data somewhere first.

#### Value recipient normalization on import
`parseRecipient()` in `xmlParser.ts` does not trust the feed's `<podcast:valueRecipient>` `type` attribute — it normalizes every recipient at parse time (the single choke point covering channel- and track-level value blocks):
- **Type detection**: type is derived from the address via `detectAddressType()` (`src/utils/addressUtils.ts`) — an `@` in the address means `lnaddress`, otherwise `node`. Feeds from older node-only tools (the original musicsideproject.com) wrote `type="node"` even for Lightning addresses; this fixes them on import. Mirrors the editor's auto-detection on manual address edit (`RecipientsList.tsx`).
- **Legacy MSP migration**: a recipient whose address equals `LEGACY_MSP_NODE_PUBKEY` (`types/feed.ts`, the MSP 1.0 support node pubkey) is swapped to the MSP 2.0 lnaddress identity (`MSP_SUPPORT_RECIPIENT` = `MSP 2.0` / `chadf@getalby.com`), **preserving the existing split** and dropping keysend-only `customKey`/`customValue`. Matches on the pubkey (unique, unforgeable), not the name. `LEGACY_MSP_NODE_PUBKEY` / `MSP_SUPPORT_RECIPIENT` in `types/feed.ts` are the single source of truth.
- Tests in `xmlParser.test.ts` cover type detection, the legacy migration (swap, split preservation, case-insensitive match, track-level coverage), and round-trip to `method="lnaddress"` output.

#### Track order and item pub dates
RSS consumers overwhelmingly sort `<item>`s **newest-first**, so an album only plays in order if track 1 carries the **newest** `pubDate`. Nothing in the feed pipeline sorts items — `xmlGenerator.ts` emits `album.tracks` verbatim and `xmlParser.ts` keeps document order — so `src/utils/trackOrder.ts` is the single place keeping "position in the editor list" and "pubDate" in agreement. The bug it fixes (#94): `createEmptyTrack()` stamps `pubDate: new Date()`, so tracks added 1..N ascended and every album MSP generated played backwards.
- **Stamp the date in the reducer, not in `createEmptyTrack`.** `Editor.tsx`'s "+ Add Track" dispatches a fully-built `createEmptyTrack` payload, so a default inside the factory loses. `ADD_TRACK` overrides `pubDate` with `nextTrackPubDate()` (one minute older than the current oldest track, or `album.pubDate` for the first), which keeps every dispatch site correct including any added later.
- **`REORDER_TRACKS` must resequence dates too**, or a reorder is invisible to podcast apps — it renumbers `trackNumber`/`episode` and then runs `resequenceTrackDates()`.
- **`resequenceTrackDates()` preserves the existing multiset of dates** (sorts them descending, reassigns by index) rather than laddering from scratch, so an episodic feed's real weekly dates survive a reorder. Only ties and unparseable dates get spread by `TRACK_DATE_STEP_MS`. It's idempotent, which is what makes it safe on the Track # input's per-keystroke `REORDER_TRACKS`.
- **Imports are never rewritten silently.** `trackOrderIssue()` classifies a list as `'reversed'` (every track numbered, episodes descending — a newest-first import) or `'dates'` (pubDates not strictly descending, including the all-identical case), and `Editor.tsx` shows a `.track-order-warning` banner whose button dispatches `FIX_TRACK_ORDER`. Check `'reversed'` first: it needs the array flipped before the dates are resequenced.
- `api/example-feed.ts` staggers its three items **descending** on purpose — it's the shipped demonstration of the convention. Don't "fix" it back to ascending.
- Covered by `src/utils/trackOrder.test.ts`, `src/store/feedStore.test.ts` (which is why `feedReducer`/`FeedState` are exported), and the track-order block in `xmlGenerator.test.ts`. There is no vitest config, so tests run in `node`; `feedStore.test.ts` stubs `localStorage` in a `vi.hoisted()` block because the store reads it at import time.

#### Enclosure file size (`<enclosure length>`)
The attribute is **bytes**, not MB — `fieldInfo.ts` said MB for a long time, which is plausibly how the bug below took root. MSP used to hardcode `enclosureLength: '33'` in three `Editor.tsx` handlers under a comment reading "Set placeholder file size", purely to satisfy the SaveModal validator's non-empty File Size requirement. Every feed MSP generated therefore claimed every track was 33 bytes.
- **Measurement**: `detectMediaSize()` (`src/utils/audioUtils.ts`) does a HEAD request and reads `Content-Length`. That header is **CORS-safelisted**, so it's readable from any host sending `Access-Control-Allow-Origin` — the host does *not* need to list it in `Access-Control-Expose-Headers`. Follows the `getAudioDuration` / `detectImageMetadata` conventions: 10 s `AbortController` timeout, never rejects, resolves `null`.
- **Fallback**: `resolveMediaSize(url, durationSeconds?)` prefers the measured size, else estimates from duration at 128 kbps (`hhmmssToSeconds()` parses an existing `HH:MM:SS` back to seconds), else a flat ~5 MB. Always returns a number because RSS requires the attribute — but only the first branch is a measurement. A fixed constant is wrong in both directions, which is why the estimate is duration-derived rather than a new magic number.
- **Legacy cleanup**: `xmlParser.ts` drops any length below `MIN_PLAUSIBLE_MEDIA_BYTES` (1024) as unknown — previously it only dropped `0` — so `33` and friends don't propagate. `backfillEnclosureSizes()` in `App.tsx` then measures the missing ones in the background after import, dispatching `UPDATE_TRACK` per track as each resolves (index-based async dispatch, same pattern as the Editor's duration handlers). **The backfill is what makes the parser change useful** — without it the user just gets an empty required field.
- Tests in `audioUtils.test.ts` (duration parsing, HEAD success/rejection/absent-header/blocked, estimate + fallback branches) and `xmlParser.test.ts` (dropping `33`/`0`/non-numeric, keeping a plausible size).

#### Podcasting 2.0 `<podcast:image>` tag (additional images)
The modern singular `<podcast:image>` tag (supersedes the deprecated plural `<podcast:images>`) lets artists attach EXTRA artwork of different aspect ratios (e.g. a wide `canvas` background for Now Playing screens, a `banner`, a `social` card) at both feed and track level. This is separate from the primary cover (`imageUrl`/`trackArtUrl`), which is still emitted as `<itunes:image>` + `<image>`.
- **Data model** (`types/feed.ts`): `PodcastImage` interface (`href` required; optional `purpose`, `alt`, `aspectRatio`, `width`, `height`, `type`) + `podcastImages?: PodcastImage[]` on `Album`, `Track`, `PublisherFeed`, and `BaseChannelData`. `PODCAST_IMAGE_PURPOSES` is the canonical preset list (artwork/banner/canvas/social/publisher/circular/poster) feeding the UI dropdown. Album/video carry feed-level + per-track images; publisher feeds carry feed-level only (no tracks).
- **Generate** (`xmlGenerator.ts`): `generatePodcastImageXml()` emits one `<podcast:image>` per array entry at channel + item level (attribute order href/purpose/alt/aspect-ratio/width/height/type, empty attrs omitted; TS `aspectRatio` → XML kebab `aspect-ratio`). The deprecated `<podcast:images>` (plural, srcset) is **no longer generated**.
- **Parse** (`xmlParser.ts`): `parsePodcastImages()` reads all `<podcast:image>` elements (normalizing fast-xml-parser's single-vs-array quirk). Channel-level images are parsed once in `parseCommonChannelElements()` so every feed type (album, publisher, future) gets them via the `...common` spread; item-level images are parsed in `parseTrack()`. `'podcast:image'` is registered in BOTH `KNOWN_CHANNEL_KEYS` and `KNOWN_ITEM_KEYS` — load-bearing, or the tag would also be captured into `unknown*Elements` and double-emitted. Legacy `<podcast:images>` (plural) is still parsed into `trackArtUrl` for back-compat.
- **UI** (`PodcastImagesList.tsx`, mounted in `Editor.tsx` at album/video feed + track level, and in `PublisherEditor/PublisherArtworkSection.tsx` for publisher feeds): artists paste a URL; `detectImageMetadata()` (`utils/imageMetadata.ts`) loads the image to auto-fill width/height/aspect-ratio/MIME and `suggestPurpose()` pre-selects a purpose. `detectImageMetadata` never rejects and has a 10s timeout (mirrors `audioUtils.getAudioDuration`). The blur handler only writes fields it actually detected (a failed/timed-out re-detect never erases prior values), bails if the row was removed or its URL changed during load, and skips re-detecting an unchanged URL (per-row `detectedUrls` ref). State flows through existing `UPDATE_ALBUM`/`UPDATE_TRACK`/`UPDATE_PUBLISHER_FEED` actions (no new reducer action) via the list's `onChange(images)` which replaces the whole array. Known follow-up: the legacy `trackArtWidth`/`trackArtHeight` parser fields are now written-but-unread by the generator.
- Tests in `xmlGenerator.test.ts`, `xmlParser.test.ts` (incl. round-trip) and `imageMetadata.test.ts` (pure helpers) cover the feature.

### OP3 Analytics
- [OP3](https://op3.dev/) (Open Podcast Prefix Project) provides open, privacy-respecting download stats
- Toggle in Album Info enables/disables OP3 prefix on enclosure URLs
- `Album.op3` boolean field controls prefix generation
- Generator (`xmlGenerator.ts`): `applyOp3Prefix()` prepends `https://op3.dev/e,pg={podcastGuid}/` to enclosure URLs (strips `https://` from target, keeps `http://`)
- Parser (`xmlParser.ts`): `stripOp3Prefix()` detects and removes OP3 prefix on import, sets `album.op3 = true`
- Stats link shown in Save modal (hosted section) — OP3 needs a few days of downloads before stats page is available
- Tests in `xmlGenerator.test.ts` and `xmlParser.test.ts` cover prefix generation, stripping, and round-trip

### Email Magic-Link Feed Ownership
A non-Nostr, password-free way to **own and recover MSP-hosted feeds** (for self-hosting musicians who avoid Nostr/Google — e.g. Blossom/nostr.build users whose media is content-addressed so MSP hosts their static feed XML). It's a **third owner type alongside the edit token and Nostr** — every hosted feed write tries token → Nostr owner → email owner.
- **Auth model**: passwordless magic link. The raw email is **never persisted** — only `emailHash` (keyed HMAC via `MSP_EMAIL_HASH_KEY`) is stored. Sessions are stateless HS256 JWTs (`MSP_SESSION_SECRET`), sent as `X-Email-Session: Bearer <jwt>`. Helpers in `api/_utils/emailAuth.ts` (mirrors `adminAuth.ts`'s `{valid, ...}` shape).
- **Blob storage** (`api/_utils/accountStore.ts`): `@vercel/blob` has no private mode, so both namespaces are public blobs with **unguessable paths** — single-use link records at `accounts/links/<sha256(token)>.json` (deleted on redeem) and the per-account feed index at `accounts/index/<emailHash>.json` (contents are just public feed GUIDs). External callers can't `list()` or guess the store subdomain + high-entropy path.
- **Endpoints**: `api/auth/magic-link.ts` (POST, rate-limited per IP+emailHash, enumeration-safe `{sent:true}`, claim requires proving the edit token first), `api/auth/verify.ts` (POST, single-use redeem → session; a `claim` link also stamps `ownerEmailHash` onto the feed + indexes it), `api/account/feeds.ts` (GET, lists the account's feeds via the shared `feedHydrate.ts` helper).
- **Hosted writes** (`api/hosted/[feedId].ts`): `FeedMetadata.ownerEmailHash`/`emailLinkedAt`; PUT/DELETE accept an email-session owner (DELETE previously had no owner path at all — fixed for both Nostr and email); PATCH generalized to link either a Nostr or email identity (`emailSessionOwns()` helper).
- **Email send** (`api/_utils/sendEmail.ts`): Resend, send-only, no-ops via `isEmailConfigured()` when unconfigured (mirrors `isPodpingConfigured()`).
- **Frontend**: `EmailLoginModal.tsx` (login + claim), `VerifyMagicLink.tsx` at route `/auth/verify`, `emailSession.ts` (request/verify + `withEmailAuth()`), `emailSessionStorage` in `storage.ts`. `hostedFeed.ts` has `*WithEmail` variants + `linkEmailToFeed` (analog of `linkNostrToFeed`). SaveModal prefers Nostr → email → token and drops the "save your token" gate for email users; ImportModal "My Hosted Feeds" works for email accounts. **This is a production feature — not gated behind the experimental flag.**
- **Setup prerequisites** (must be done before it works end-to-end): a Resend account + verified domain, the env vars above, and the SPF/DKIM/DMARC DNS records. Until then it cleanly no-ops.
- **Known follow-ups** (not yet done): the publisher `CatalogFeedsSection.tsx` "Browse My MSP Feeds" and the `/admin` `AdminPage.tsx` dashboard are still Nostr-only (not generalized to email); NIP-98 events still aren't bound to URL/method (pre-existing).
- Tests: `api/_utils/emailAuth.test.ts`, `sendEmail.test.ts`, `accountStore.test.ts`, `api/auth/*.test.ts`, `api/account/feeds.test.ts`, `api/hosted/feedId-email-auth.test.ts`.

### Nostr Integration
- NIP-07 browser extension support for signing
- NIP-46 remote signer support
- **Kind 30054** — full RSS XML embedded in a parameterized-replaceable event (`d`-tag = `podcastGuid`). Used by "Save RSS feed to Nostr" for personal cross-device sync. Read back via `loadAlbumsFromNostr` in `src/utils/nostrSync.ts`
- **Kind 36787 + 34139** — Nostr Music track events and playlist event. Published via `publishNostrMusicTracks` in `src/utils/nostrSync.ts:648`, imported via `fetchNostrMusicTracks` at `:384`. These three functions (plus `deleteNostrMusicTracks`) default to `MUSIC_RELAYS` rather than `DEFAULT_RELAYS` — `MUSIC_RELAYS` (defined in `src/utils/nostrRelay.ts`) is `DEFAULT_RELAYS` + `wss://drops.basspistol.org`, a public relay that only accepts music kinds and would reject kind 0/30054/1063 traffic if we sent it there. Kind 36787 is a lossy format — it carries no description/file-size/required-duration — so the SaveModal validator skips those requirements in `nostrMusic` mode to let round-tripped albums republish. Field-by-field mapping between RSS output and these events (useful when building converters or reasoning about what survives a round-trip) is in `docs/rss-nostr-music-crossref.md`.
  - **The `released` tag is `MM/DD/YYYY` and is read/written in UTC.** `formatReleasedDate` and `parseReleasedDate` (`src/utils/dateUtils.ts`) are the two ends of one wire — `nostrSync.ts:556` writes, `nostrMusicConverter.ts:157` reads — and they used to disagree twice over. The reader parsed `DD/MM`, so a publish→import round-trip swapped month and day (11 Mar 2026 came back as 3 Nov 2026): silent for days 1-12, and for 13+ `new Date(y, 12+, d)` rolled into the next year. Separately the writer used *local* getters on a UTC `pubDate`, so every date published from a browser west of Greenwich was **a day early** — correct in Tokyo, wrong in New York. Both fixed; the reader keeps a `DD/MM` fallback only when the first field is >12, since other tools emit that and it's unambiguous. MM/DD is the format already on relays, so reading it is also what makes existing published events parse correctly. `dateUtils.test.ts` covers every day of a month and is timezone-independent — **keep it that way**, a test that asserts a local date passes in one CI region and fails in another.
- **Kind 5 (NIP-09)** — deletion request used by the "Unpublish (delete)" button next to "Publish to Nostr Music". `deleteNostrMusicTracks` (`src/utils/nostrSync.ts:741`) builds `a`-tag references for each kind-36787 track event and the kind-34139 playlist; relays *may* honor it. Success message says "Sent deletion request..." rather than "Deleted" to be honest about NIP-09 semantics
- **Kind 1063 (NIP-94)** — file metadata event published by the Blossom destination so MSP can serve a stable `${origin}/api/feed/{npub}/{podcastGuid}.xml` URL that always resolves to the latest Blossom upload
- **Kind 24242 (BUD-01)** — Blossom auth event signed when uploading
- Blossom server uploads for file hosting (used by both the Blossom and nsite destinations)
- **NIP-71 naddr video resolution**: Pasting an `naddr` string (bare, `nostr:` prefixed, or in a URL like `nostu.be/v/naddr1...`) into a Video URL field auto-resolves the NIP-71 video event (kind 34235/34236) from relays and fills in URL, MIME type, and duration. Implementation in `utils/nostrVideoConverter.ts` with paste handler in `Editor.tsx`. Supports both modern `imeta` tags and legacy separate tags (`url`, `m`, `duration`).
- **nsite (NIP-5A) publishing**: Publish feeds to decentralized nsites via Blossom upload + NIP-5A manifest (kind 35128). Available in Save modal → "Publish to nsite" (requires Nostr login). Uploads RSS XML to a Blossom server, publishes a site manifest to relays, and auto-submits the nsite gateway URL to Podcast Index. Site ID auto-generated from feed GUID. Implementation in `utils/nsite.ts` with UI in `SaveModal.tsx`.

## Key Patterns

### Component Structure
- Modal-based dialogs (`components/modals/`)
- Collapsible sections using `Section.tsx`
- Editor components split between Album (`Editor.tsx`) and Publisher (`PublisherEditor/`)
- `InfoIcon` component accepts `position` prop (`"right"` default, `"left"` for edge fields)

### Modal Footer Convention
All modal footers place action buttons on the left and the Cancel button on the far right, separated by a `<div style={{ flex: 1 }} />` spacer. Footer wrapper divs need `width: '100%'` so the spacer works inside `.modal-footer`.

### Modal sizing — the cap lives on `.modal`, not `.modal-content`
`.modal` is `max-height: 90vh` and `.modal-content` is `flex: 1 1 auto; min-height: 0; overflow-y: auto`, so a dialog sizes to its content and only scrolls once the whole thing would overflow the viewport. `min-height: 0` is load-bearing — a flex item won't shrink below its content without it, so the cap can't take effect. `.modal-content` previously carried `max-height: 60vh`, which forced an internal scrollbar regardless of available space. Don't reintroduce a fixed height on the content. `.preview-modal` (`95vh`, `!important`) and `.confirm-modal` (`max-height: none`) keep their own overrides, and the small-phone media query already used this shape.

### New Feed Flow
The "New" button opens `NewFeedChoiceModal` with two paths:
- **Start Blank** — creates an empty feed (clears data)
- **Use Template** — opens `ImportModal` in template mode (`templateMode` prop), which imports a feed with regenerated GUIDs and no hosted credentials. Template handlers (`handleTemplateImport`, `handleTemplateLoadAlbum`) in `App.tsx` regenerate GUIDs and clear `pendingHostedStorage`. `handleTemplateImport` calls `handleImport(xml, undefined, true)` — the third `regenerateGuids` arg makes `handleImport` mint **both** a fresh feed `podcastGuid` **and** a fresh `guid` for every track (album/video) via `regenerateAlbumGuids()` in `src/utils/regenerateGuids.ts`. Publisher templates only get a new feed `podcastGuid` — their `remoteItems` reference real external feeds, so those `feedGuid`s are preserved. **Regenerating per-track guids is load-bearing**: without it, duplicating one feed from another clones its track `<guid>`s verbatim, so unrelated tracks across two feeds collide and podcast apps / Podcast Index treat them as the same episode (the Live at Rockpile / Amnesia incident). Any new "duplicate this feed" path must route through `regenerateAlbumGuids()` (or the `regenerateGuids` flag), never copy tracks as-is.

### Accessing Nostr State
Use the `useNostr` hook to access logged-in user info:
```tsx
const { state: nostrState } = useNostr();
if (nostrState.isLoggedIn && nostrState.user?.npub) {
  // User is logged in, can access nostrState.user.npub
}
```

### Nostr signing — always use the timeout wrappers + pre-flight
Bare `signer.signEvent()` and `signer.getPublicKey()` calls hang the UI when a NIP-46 remote signer is unreachable (phone asleep, Amber backgrounded, relay dropped). Never call them directly. Use the wrappers in `src/utils/nostrSigner.ts`:
- `signEventWithTimeout(event, timeoutMs?)` — 60 s NIP-46 / 30 s NIP-07 default
- `getPublicKeyWithTimeout(timeoutMs?)` — same defaults

Both reject with a user-friendly "open your signer app and approve" message on timeout. Note: NIP-46 has no cancellation primitive, so the remote request continues on the signer's side — we just stop waiting on the UI.

Before any user-triggered handler that ends up signing (Save modes that touch Nostr, "Load from Nostr", "Browse My MSP Feeds", "Host on MSP" with Nostr linked, "Link Nostr Identity"), call `checkSignerConnection()` as a pre-flight and bail with `health.error` if `connected` is false — this catches a dead signer in ≤5 s instead of waiting the full per-call timeout. `SaveModal.tsx` `handleSave` is the canonical reference. The pre-flight is best-effort, not a substitute for the per-call timeouts (state can degrade between the check and the actual call).

### Community Support Recipients
MSP 2.0 and Podcastindex.org are auto-added as value recipients with small splits. Two different behaviors by context:
- **New feeds** (manual entry): `ADD_RECIPIENT`/`UPDATE_RECIPIENT` actions in `feedStore.tsx` auto-append support splits when the first user address is added
- **Imported feeds**: Support splits are NOT auto-added. Instead, `RecipientsList.tsx` shows an "Add Community Support" button in the Value section when user recipients exist but support splits are missing

Key helpers in `types/feed.ts`: `isCommunitySupport()`, `hasUserRecipients()`, `createSupportRecipients()`, `COMMUNITY_SUPPORT_RECIPIENTS`. These are the canonical definitions — imported by both `feedStore.tsx` and `RecipientsList.tsx`.

Imported feeds carrying the **legacy MSP 1.0 support node** (`LEGACY_MSP_NODE_PUBKEY`) are auto-migrated to the MSP 2.0 lnaddress at parse time — see "Value recipient normalization on import" under XML Handling.

### Adding New Fields
1. Add to type definition in `types/feed.ts`
2. Add to `createEmpty*` factory function
3. Add action type to `FeedAction` union in `feedStore.tsx`
4. Handle in reducer switch statement
5. Add UI component and dispatch calls
