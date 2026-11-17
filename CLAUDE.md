# CLAUDE.md

Guidance for Claude Code in this repository. Keep this file short (well under 30k characters): it loads into every session. Long reference lives in `docs/claude/`; each file is named below with when to read it. Do not `@`-import those files — an import loads them too.

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

## Project

MSP 2.0 (Music Side Project Studio) is a React 19 + TypeScript + Vite web app that builds Podcasting 2.0 RSS feeds for music albums, videos and publisher catalogs, with Value 4 Value (Lightning) splits, Nostr sign-in and sync, Podcast Index submission and podping. `api/` holds Vercel serverless functions, including MSP's own feed hosting. A Tauri desktop app is a fork of this repo (see "Desktop App fork").

## Commands

```bash
npm ci               # install (Node ^24.22.1, per package.json engines; CI uses 24)
npm run dev          # Vite dev server; /api/* is proxied to production musicsideproject.com
npm run build        # tsc -b && vite build — this is the typecheck
npm run test         # Vitest, node environment
npm run test:watch
npm run lint         # ESLint; must report zero problems
npm run preview
```

- **Typecheck with `npm run build` (or `npx tsc -b`), never `tsc --noEmit`.** The root `tsconfig.json` is references-only, so `--noEmit` checks zero files and always passes. `tsconfig.api.json` typechecks `api/` (Vercel's builder doesn't) but excludes `api/**/*.test.ts`, whose `vi.fn()` response mocks are deliberately partial.
- **Tests run in node; there is no DOM test setup and no vitest config.** UI wiring is proven only in a real browser — read `docs/claude/browser-testing.md` before testing a UI change. Because `npm run dev` proxies `/api` to production, never drive Host on MSP, Submit to PodcastIndex, Podping or Nostr publishing from a local test.
- `npm test` is hermetic. Two corpus tests matter for feed work: `src/utils/feedCorpus.roundTrip.test.ts` (committed real feeds, snapshot of what a parse→save keeps; runs in `npm test`) and `api/_utils/feedCorpus.network.test.ts` (live network, opt-in: `MSP_FEED_CORPUS=1 npx vitest run api/_utils/feedCorpus.network.test.ts` — run it before and after touching any fetch guard, since every other test mocks `fetch`).
- **Committed tooling goes in `tools/`.** `scripts/` is gitignored (local scratch); a file written there silently never gets committed.

## CI and lint

- `.github/workflows/ci.yml` runs build, test and lint on every PR and on pushes to `master`; all three block. Vercel's green check is only a build and deploy, not a test run.
- **Lint stays at zero.** The Desktop fork lints the same files as a blocking job, and a fix pushed to its sync PR is wiped by the next sync. A rule this repo can't satisfy gets turned off in `eslint.config.js` on purpose, never left failing.
- An `eslint-disable-next-line` must be the **last** line before the statement it targets; an explanation placed after it silently targets the wrong line. The existing disables carry their reason inline.
- Actions are pinned to `@v7`. Keep `cache: npm` explicit on `setup-node`: auto-caching needs a `packageManager` field this repo doesn't have, so removing the line would silently stop caching.

## Environment variables

No `.env.example`; request values from the team. For a one-off script, `vercel env pull <tmpfile> --environment=development` gives working values (the `.env.local` copy can be stale); delete the file after. A new or changed variable reaches only new deployments, so redeploy production after `vercel env add`.

- `PODCASTINDEX_API_KEY`, `PODCASTINDEX_API_SECRET` — Podcast Index API.
- `BLOB_READ_WRITE_TOKEN` — read-write key to every hosted feed and the `accounts/` namespace. Vercel's Blob store injects it; rotating updates the var, but deployments must be redeployed. When rotating because of exposure, do **not** take Vercel's "delay expiration of old credentials" option.
- `MSP_ADMIN_PUBKEYS` — full admin; **hex only**, comma-separated (an npub never matches).
- `MSP_CHART_PUBKEYS` — npubs or hex that may read `/charts` and nothing else.
- `MSP_ADMIN_KEY` — static bearer secret, a second full-admin path that bypasses NIP-98 on the hosted and boost endpoints. Unset it if unused. Compared with `timingSafeEqualString()`.
- `VITE_CANONICAL_URL` (build-time, client) and `CANONICAL_URL` (server) — canonical origin, default `https://musicsideproject.com`.
- `PODPING_ENDPOINT_URL`, `PODPING_BEARER_TOKEN` — MSP's hivepinger service; podping is skipped when unset. `PODPING_HIVE_ACCOUNT`, `PODPING_HIVE_RPC_URL` — used only by `/api/podping-verify`.
- `RESEND_API_KEY`, `MSP_EMAIL_FROM`, `MSP_SESSION_SECRET`, `MSP_EMAIL_HASH_KEY`, `MSP_MAGIC_LINK_TTL_MIN` — email magic-link sign-in; it no-ops when unconfigured. Rotating `MSP_SESSION_SECRET` ends all sessions; rotating `MSP_EMAIL_HASH_KEY` breaks email→feed ownership.
- `HELIPAD_WEBHOOK_TOKEN`, `MSP_BOT_INGEST_TOKEN`, `MSP_BOOST_NAMESPACE`, `CRON_SECRET`, `MSP_LISTENER_HASH_KEY` — boost capture and the chart; see `docs/claude/boosts-and-charts.md`.

## Deployment

- Vercel project in the team `chadfs-projects`. **musicsideproject.com** (apex + `www`) is canonical and runs `master`; `new.musicsideproject.com` and the legacy `msp.podtards.com` are the same project. DNS is at Squarespace. `msp.podtards.com` must never appear in a newly generated URL.
- Vercel CLI: commands that act on a deployment need `--scope chadfs-projects` (the CLI's default scope on Chad's Mac mini is a personal account), e.g. `vercel redeploy <url> --target production --scope chadfs-projects`. `vercel env ls/add/pull` work in the repo without it.
- Version is `0.1.{commit count - 255}`, computed in `vite.config.ts` (`getAutoVersion()`, which unshallows Vercel's clone); shown in the hamburger menu.
- `vercel.json` couplings: `functions.maxDuration` is 60 s for the boost ingest/rebuild and 130 s for `api/hosted/*.ts` and `api/pubnotify.ts`, which must stay above the post-save podping wait (`HOSTED_FEED_SETTLE_MS`); everything else runs on the default, so adding work to a guarded endpoint may need a `maxDuration`. The `/assets/(.*)` immutable cache is safe only because Vite hashes those names — don't extend it to `public/`. The `msp.podtards.com` redirect excludes `/api/` so feeds keep their in-function 301. A daily cron calls `/api/boosts/rebuild`.
- Never import `src/assets/msp-logo.png` into a component (1.8 MB, rendered at 40 px; use `/msp-logo-192.png`). Don't delete it either: the fork's own `App.tsx` may still use it.

## Git and PRs

- `git pull` at the start. Main branch: `master`. Imperative commit subjects. Add Co-Authored-By for Claude-assisted commits. No pre-commit hooks.
- PRs are squash-merged and their branches deleted. **Prefer one PR over a stack**: after a base squash-merges, the child conflicts. The repair recipe is in `docs/claude/desktop-fork.md`.
- Before a UI PR, test it in a real browser and say in the body what you did and didn't verify.
- Check `gh issue list` for requests and bugs.

## Desktop App fork

[MSP-2.0-Desktop-App](https://github.com/ChadFarrow/MSP-2.0-Desktop-App) is a Tauri fork. A push to `master` dispatches its **Sync from Web Repo** job (`.github/workflows/notify-desktop.yml` here; pushes that touch only `**.md` or `docs/**` are skipped and wait for the fork's daily 06:00 UTC run). The job merges web `master`, opens a PR with auto-merge, and every merge to the fork's `master` publishes a release to app users. **Read `docs/claude/desktop-fork.md` before changing a file the fork has diverged on, bumping a dependency, or repairing a sync.** The rules that bite most:

- **The sync resolves every conflict in the fork's favour, and git then never re-offers that commit.** A change to a diverged file does not reach the app, and a green sync PR does not mean it did. Diverged files include `App.tsx`, `Editor.tsx`, `SaveModal.tsx`, `feedStore.tsx`, `hostedFeed.ts`, `publisherPublish.ts`, `publisherControl.ts`, `CatalogFeedsSection.tsx`, `App.css`, `package-lock.json` and this `CLAUDE.md` (full list in the doc). Such a change needs a port PR on the fork.
- A new plain `fetch('/api/…')` in a shared file forks that file (the packaged app has no same-origin `/api` and rewrites calls to `apiFetch()`).
- The fork edits tracks in its own `TracksSection.tsx`, so a track-level UI change needs a hand edit there.
- Code must work across the whole semver range of a dependency, not just this lockfile; the fork's lockfile resolves differently. Port a dependency bump to the fork **before** the upstream PR merges.
- A new shared file a port depends on is copied byte-identically, or the later sync conflicts and keeps the stale copy.
- The fork's release workflow has no concurrency group: let one release finish before anything else merges there.
- The fork has jsdom DOM tests; this repo has none.

## Architecture

- **Three feed modes** (header dropdown): Album, Video, Publisher (a catalog of `podcast:remoteItem`s pointing at album feeds).
- **State**: React Context + `useReducer`, no Redux. `src/store/feedStore.tsx` (feed state, saved to localStorage per feed type; actions are the `FeedAction` union), `nostrStore.tsx` (`useNostr()`), `themeStore.tsx`, `experimentalStore.tsx` (`useExperimental()`: `showExperimental` is DEV-only; `showBeta` is the production opt-in).
- `src/types/feed.ts`: `Album`, `Track`, `Person`, `ValueRecipient`, `PublisherFeed`, `RemoteItem`, `FeedType`, the `createEmpty*` factories and the community-support constants.
- `src/components/`: `Editor/` (album/video), `Editor/PublisherEditor/`, `modals/`, `admin/`, `charts/`. `src/utils/`: XML parse/generate, Nostr, hosting, checks.
- `api/`: Podcast Index (`pisearch`, `pisubmit`, `pubnotify`), podping (`podping`, `podping-verify`), feed fetching (`proxy-feed`, `verify-feed-url`), hosting (`hosted/`), email auth (`auth/`, `account/`), admin (`admin/`), boosts (`boosts/`), Nostr pointer (`feed/[npub]/[guid]`), shared helpers in `api/_utils/`. `api/` cannot import from `src/`, so a few modules are deliberate mirrors (below).
- TypeScript strict with `noUnusedLocals`/`noUnusedParameters`; ES modules only; target ES2022. Never commit secrets.

**Adding a field:** add it to the type in `src/types/feed.ts` and its `createEmpty*` factory, add an action to `FeedAction` and handle it in the reducer, then the UI. If it comes from or goes to XML, read `docs/claude/xml-round-trip.md` first.

## Rules that span the codebase

- **Feed URLs MSP writes use the canonical domain**: `buildHostedUrl()` (`src/utils/hostedFeed.ts`) on the client and `getBaseUrl()` (`api/_utils/feedUtils.ts`) on the server — never `window.location.origin` and never the request host. The origin is right only for the NIP-98 `u` tag, which must name the URL the request goes to.
- **A hosted feed with no `.meta.json` is a refusal (409), never a migration path**: the meta blob holds the only credential, and the `feedId` is the public `podcastGuid`.
- **Any "duplicate this feed" path goes through `regenerateAlbumGuids()`** (or `handleImport`'s `regenerateGuids` flag), so a copy never reuses another feed's track `<guid>`s.
- **Feed XML: an element is either modelled or passed through, never both.** A key added to `KNOWN_CHANNEL_KEYS`/`KNOWN_ITEM_KEYS` without parsing it is deleted on save; an element both passed through and generated is written twice. Values stay strings (`createFeedXmlParser()` is the one parser configuration). `escapeXml` goes on every interpolation, attributes included.
- **Fetching user-supplied URLs:** `/api/verify-feed-url` must never return response bytes; `/api/proxy-feed` returns only feed-shaped, size-capped bytes with a forced content type. Both check every redirect hop via `api/_utils/safeFetch.ts`. Never add a third-party CORS proxy.
- **Every `checkRateLimit` key gets an endpoint prefix** (one shared `Map`); limits are per warm lambda, not a security control.
- **`getFeedUrlError()` is a hard 400** at the PI/podping endpoints, not advice. `src/utils/urlValidation.ts` and `api/_utils/urlValidation.ts` must stay byte-identical apart from the api header (a test enforces it).
- **A new manual feed-URL input that submits to PI or podping needs five pieces**: `normalizeFeedUrl` in `onChange`, a `getFeedUrlError` gate, a `verifyFeedUrl` pre-flight with the "Submit anyway" latch, `force` + `isGuardRefusal` handling on that same latch, and `normalizeFeedUrl` again at the send site.
- **Every podping trigger passes the feed's `medium`**, or it goes out as `pp_podcast_update`, which MSP's music consumer ignores.
- **Never read-modify-write a Vercel Blob.** The CDN caches by pathname with a 60 s floor and ignores query strings, so a read after a write is stale. Write immutable records, or write a whole file from complete inputs. (The hosted `.meta.json` and account-index updates still read-modify-write — a known, unfixed risk; see `docs/claude/hosting-and-indexing.md`.)
- **Nostr signing:** never call `signer.signEvent()`/`getPublicKey()` directly. Use `signEventWithTimeout()`/`getPublicKeyWithTimeout()` and run `checkSignerConnection()` before any user action that signs (`src/utils/nostrSigner.ts`).
- **Feed-scoped local state in a publisher section must reset on import** (keyed on `FeedState.publisherFeedInstance`, never on the editable `podcastGuid`).
- **Async writes dispatch by stable id, never by an array index captured before an `await`** — the user can reorder meanwhile.
- **Experimental vs beta:** anything behind `showExperimental` never reaches production. Editor features users may try go behind `showBeta`, carry `<BetaTag />` and the `beta-field` class, and get an entry in `BETA_FEATURES` (`BetaBanner.tsx`). With beta off, hide the way to **add** beta data, never data a feed already has.
- **Community support splits** (`COMMUNITY_SUPPORT_RECIPIENTS`, `isCommunitySupport()` in `src/types/feed.ts`): new feeds get them automatically when the first user address is added; imported feeds get an "Add Community Support" button instead. `isCommunitySupport()` also accepts the older `MSP 2.0` / `chadf@getalby.com` pair on purpose — dropping it would make old feeds look unsplit and add a second MSP split.

## UI conventions

- Modal footers: action buttons on the left, Cancel on the far right, separated by `<div style={{ flex: 1 }} />`; footer wrappers need `width: '100%'`.
- The modal height cap lives on `.modal` (`max-height: 90vh`); `.modal-content` flexes with `min-height: 0`. Don't put a fixed height on `.modal-content`.
- `.form-input` sets no width, so a row that puts something beside a `.form-grid` overflows on a phone unless the fields can wrap (`flex: 1 1 15rem; min-width: 0`).
- Collapsible sections use `Section.tsx`.
- The **New** button opens `NewFeedChoiceModal`: Start Blank, or Use Template (`ImportModal` with `templateMode`, imported through `handleTemplateImport`, which regenerates GUIDs and drops hosted credentials and the source's identity tags).

## Reference docs (read when relevant)

- `docs/claude/api-security.md` — before changing anything in `api/` that fetches a URL, validates a feed URL, rate-limits, sets CORS or checks auth; also the dependency posture and the audited security follow-ups still open.
- `docs/claude/hosting-and-indexing.md` — hosted feeds, Podcast Index, podping, domains and redirects, email magic-link ownership.
- `docs/claude/xml-round-trip.md` — parser/generator rules, tags MSP keeps, Listing (block tags), pinned tracks, alternate versions, enclosure size, `podcast:image`, track order, OP3, the corpus round-trip test.
- `docs/claude/feed-check.md` — the import health report, Save gate rules and the link check.
- `docs/claude/publisher-catalog.md` — publisher feeds, link-back rules, several publishers per album, `<podcast:publisher>` shapes.
- `docs/claude/save-modal-and-beta.md` — Save modal destinations and the experimental/beta gates.
- `docs/claude/nostr.md` — event kinds, relays, signer and NIP-46 rules.
- `docs/claude/boosts-and-charts.md` — boost ingest, the derived store, the Helipad importer and the private chart.
- `docs/claude/desktop-fork.md` — the fork's sync, diverged files, port and reconcile recipes, stacked-PR repair.
- `docs/claude/browser-testing.md` — driving the dev server in Chrome, handles, phone layout checks.
- `docs/rss-nostr-music-crossref.md` — field mapping between RSS and Nostr music events.
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — design and plan documents for larger features.
