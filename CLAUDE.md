# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MSP 2.0 Desktop App (Music Side Project Studio) is a cross-platform desktop application built with Tauri and React for creating Podcasting 2.0 compatible RSS feeds for music albums, videos, and publisher catalogs. It supports Value 4 Value (Lightning Network payments), Nostr integration for cloud sync, and Podcast Index integration.

This is the desktop version of MSP 2.0. The web version is at [github.com/ChadFarrow/MSP-2.0](https://github.com/ChadFarrow/MSP-2.0).

## Development

### Prerequisites
- Node.js v22+
- npm
- Rust (for Tauri desktop builds)

### Environment Setup
A `.env` file is required with the following variables:
- `PODCASTINDEX_API_KEY` - Podcast Index API key
- `PODCASTINDEX_API_SECRET` - Podcast Index API secret
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token
- `MSP_ADMIN_PUBKEYS` - Admin public keys for authentication
- `VITE_CANONICAL_URL` - Canonical URL for the application

No `.env.example` exists - request credentials from the team.

### Commands
```bash
npm run dev          # Start Vite dev server (proxies /api to musicsideproject.com)
npm run build        # TypeScript compile + Vite build
npm run lint         # ESLint
npm run preview      # Preview production build
npm run tauri:dev    # Start Tauri desktop app in dev mode
npm run tauri:build  # Build desktop app for distribution
```

### Testing
```bash
npm test             # Run all unit tests (Vitest)
npm run test:watch   # Watch mode
npx vitest src/utils/xmlParser.test.ts   # Run a single test file
npm run test:e2e     # Run Playwright E2E tests (starts dev server automatically)
npm run test:e2e:ui  # Playwright interactive UI mode
```

Unit tests use Vitest, configured in `vitest.config.ts` as **two projects**: `src` runs under jsdom with `src/test/setup.ts`, `api` runs under **node** with `src/test/setup.node.ts`. That split is deliberate — api tests are authored in the web repo, which has no vitest config and therefore runs them in node, so forcing jsdom on them broke synced tests for reasons unrelated to their code (`import.meta.url` stops being a `file:` URL; node builtin mocks need a `default` key). Run one side with `npx vitest run --project api`. Test files live alongside source as `*.test.{ts,tsx}` in **both `src/` and `api/`** (api tests existed but never ran until June 2026). Key test files:
- `feedStore.test.ts` - Reducer unit tests (all action types, community support auto-add logic)
- `feedStorePersistence.test.tsx` - Provider-level debounced auto-save + pagehide flush
- `xmlParser.test.ts` - Parser tests (parseRssFeed, parsePublisherRssFeed, feed type detection, recipient type detection/migration)
- `xmlGenerator.test.ts` - Generator tests (publisher reference output)
- `api/_utils/urlSafety.test.ts` + `api/proxy-feed.test.ts` - SSRF guard (desktop's public-host policy, NOT web's allowlist)
- `api/_utils/cors.test.ts` - Origin allowlist behavior

E2E tests are in `e2e/` and run Playwright against Chrome at multiple viewports (desktop, tablet 1024px, mobile 768px, mobile 480px). Config in `playwright.config.ts`.

### CI/CD
Push to `master` or PR triggers five parallel GitHub Actions jobs: unit tests, E2E tests, lint, a blocking dependency audit (`npm audit --omit=dev --audit-level=high` — dev-only transitives don't gate CI, shipped deps do), and **Build**.

`Build` runs `npm run build` (`tsc -b` + vite). Nothing else in CI typechecks — E2E boots `npm run dev`, which skips tsc — so before this job existed a type error only surfaced in `release.yml`, after merge, in the job that builds the app. `tsc -b` covers three projects: `tsconfig.app.json` (src), `tsconfig.node.json` (vite.config.ts) and `tsconfig.api.json` (api/, excluding its tests). **`api/` was typechecked by nothing before August 2026** — that gap hid a live bug where `api/hosted/[feedId].ts` assigned the whole `PodcastIndexNotifyResult` object to a `number` field and wrote it into every updated feed's `.meta.json`, and an `/api/verify-feed-url` that could not run at all because `assertPublicHttpUrl` didn't exist in this fork.

**Required status checks are what actually gate a merge**, not the workflow files: `Lint`, `Unit Tests`, `E2E Tests`, `Dependency Audit`, `Build`. Add a job to `test.yml` and it gates nothing until you also add it there:
```bash
gh api repos/ChadFarrow/MSP-2.0-Desktop-App/branches/master/protection/required_status_checks
```

Every push to `master` also triggers cross-platform release builds (macOS arm64/x86_64, Ubuntu, Windows) that auto-increment the version, sign artifacts, and publish a GitHub release. Multiple pushes in a day each produce a new release.

The sync workflow (`sync-upstream.yml`) fetches changes from the [web repo](https://github.com/ChadFarrow/MSP-2.0) and opens a PR via `peter-evans/create-pull-request`. It runs on a daily schedule (6 AM UTC), on manual dispatch (`gh workflow run sync-upstream.yml`), **and on every push to web `master`** (the web repo's `notify-desktop.yml` fires a `repository_dispatch: web-repo-updated`). So a web update auto-builds the desktop app end to end: web push → sync PR → CI → auto-merge → `release.yml` builds a release.

The sync workflow also deletes the web repo's own workflows from the merge: `notify-desktop.yml` (it would fire this sync at itself) and `ci.yml` (its `verify` job duplicates `test.yml`, under a check name branch protection doesn't gate on).

**Auto-merge policy:** every sync PR (clean *or* conflict) enables auto-merge, gated on the required status checks listed above. A green synced build merges and releases itself with no manual step; a red one **holds for a human**. This means CI is the safety net — build-breaking drops are caught automatically (see below), but a conflict sync that drops a feature yet still **compiles** can merge without review.

That gate is only as good as the required-checks list. It was `["Lint"]` alone until August 2026, so sync PR #34 auto-merged 28 seconds after Lint went green while its unit tests were still failing — master stayed red for three days and shipped no release. If a sync PR ever merges red again, check that list first.

**Conflict handling — important:** when an upstream change conflicts with desktop's version, the workflow auto-resolves by **keeping the desktop version** and silently drops the upstream change for that file. The PR body lists the conflicted files under "Merge conflicts were auto-resolved". Two failure modes:
- **Build-breaking drop** (CI catches it → PR stays unmerged): a non-conflicting file still imports something from the dropped code. Example: the June 2026 email magic-link auth sync (web PR #90) landed `ImportModal`'s `import { fetchEmailFeeds }` cleanly but dropped the export from the conflicted `adminAuth.ts`, so `vite build` failed and E2E never started. Unit tests still passed (they don't build the app), which is misleading — always check the E2E/build job. Fixed in desktop PR #20 by porting the email fns into the forked files (`adminAuth.ts`, `hostedFeed.ts`, `api/hosted/[feedId].ts`) so the fork *owns* a building version and future syncs auto-resolve green. See issue #21.
- **Silent drop** (compiles → auto-merges, needs post-hoc audit): the dropped upstream code isn't referenced anywhere, so it builds but a feature is missing or half-wired (e.g. the `podcast:image` dead-code case, or Podping/bottom-toolbar/NIP-71 in PRs #13/#14/#15). To audit after a conflict sync: for each conflicted file run `git diff <merge-base>..upstream/master -- <file>` (merge-base via `git merge-base origin/master upstream/master`), and open a follow-up PR porting anything real.

Recurring lint gotcha: desktop lints with `react-hooks/immutability` (which web tolerates), so a synced file that uses a `useEffect` before its declared callees breaks desktop's build on every sync. Fix these **upstream in the web repo** (a pure reorder is a no-op for web) so the clean file flows down and the fix doesn't need re-applying each sync.

## Deployment

### Web Version
- Hosted on Vercel; **musicsideproject.com** is the canonical domain. `msp.podtards.com` is a legacy alias that still resolves but must never appear in newly generated URLs — `getBaseUrl()` in `api/_utils/feedUtils.ts` enforces this
- API functions in `/api/` directory are Vercel serverless functions
- Dev server proxies `/api/*` to production via Vite config
- Build: `npm run build` (tsc + vite)

### Desktop App (Auto-Update System)
The desktop app uses Tauri's updater plugin with signed releases hosted on GitHub.

**Key files:**
- `src/utils/updater.ts` - Update check and install logic
- `src/components/modals/UpdateModal.tsx` - Update prompt UI
- `src-tauri/tauri.conf.json` - Updater config with public key and endpoint; also the webview CSP (`app.security.csp` + `devCsp`). The CSP's broad `https: wss:` connect-src is intentional — relays, Blossom servers, and artwork/audio URLs are user-configurable. `devCsp` additionally allows inline scripts and `ws://localhost:5173` for Vite HMR. If a new feature hits a CSP violation (check the webview console), extend the policy rather than nulling it

**GitHub Secrets required:**
- `TAURI_SIGNING_PRIVATE_KEY` - Base64-encoded signing key (single line, no whitespace)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Key password

**Release process:**
Releases are automatic on push to master:
1. Push changes to master branch
2. GitHub Actions auto-increments version using run number (e.g., `0.1.14`)
3. Workflow builds, signs, and publishes release automatically

For manual version control (optional):
1. Update version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
2. Create and push a version tag: `git tag v0.x.x && git push origin v0.x.x`

**Known issues and solutions:**

| Issue | Cause | Solution |
|-------|-------|----------|
| "Invalid symbol 32" signing error | Multi-line key format or whitespace in secret | Use single-line base64 key; workflow uses `tr -d '[:space:]'` to strip whitespace |
| "Resource not accessible by integration" | Parallel jobs race to create release | Manually create draft release first, then re-run failed jobs |
| Secrets not found | Secrets in Environments instead of Repository | Add to Settings > Secrets > Actions > Repository secrets |
| No update prompt in old versions | App was built before update code was added | Users must manually update once to a version with update support |
| Branch protection blocks workflow commits | Workflow can't push version bumps when status checks required | Use GitHub run number for version instead of committing |
| Build fails with unused variable error | TypeScript strict mode + ESLint enforce no unused code | Remove unused functions/variables before committing |
| Component uses outdated API after refactor | Type changed (e.g., `StoredKeyInfo.exists` to `keys[]` array) | Update all components using the old API pattern |
| "Resource not accessible by integration" on PR creation | `GITHUB_TOKEN` can't call GraphQL `createPullRequest` | Use `peter-evans/create-pull-request` action instead of `gh pr create` |
| "Command plugin:updater\|check not allowed by ACL" | Updater plugin permissions missing from capabilities | Add `updater:default` and `process:allow-restart` to `src-tauri/capabilities/default.json` |
| "error sending request for url" on Linux update check | System CA certificates not detected by reqwest | Fixed in v0.1.28+ via `native-tls-vendored` feature; older versions must manually download update |
| Linux auto-update downloads but fails to install | `tauri-plugin-updater` <2.10 lacks privilege escalation for `.deb` installs (`/usr/bin/` is root-owned) | Fixed by upgrading to `tauri-plugin-updater` 2.10+; users on older versions must manually install `.deb` via `sudo dpkg -i` |
| "Not Found" uploading `latest.json` in release | Parallel build jobs race to upload/update the same `latest.json` asset | Fixed: `includeUpdaterJson: false` on build jobs; separate `upload-updater-json` job assembles it after all builds complete |
| Windows AV false positive (NSIS:MalwareX-gen) | NSIS `.exe` installers without Authenticode EV code signing trigger heuristic AV detections | Recommend `.msi` installer; long-term fix is purchasing an EV code signing certificate (~$400-600/yr) |
| Tauri build fails with "version mismatched Tauri packages" | `npm update` bumped `@tauri-apps/*` past the Rust crates — Tauri requires matching major/minor across the NPM/crate boundary | Run `cargo update` in `src-tauri/` after any npm update that touches `@tauri-apps/*`, then commit both lockfiles |
| Build fails: Missing "./utils" specifier in @noble/hashes | @noble/hashes 2.x (via nostr-tools) requires the `.js` suffix on subpath imports | Import from `@noble/hashes/utils.js`, not `@noble/hashes/utils` |
| Sync PR: `vite build` fails "No matching export ... for import X" (E2E all "element not found", unit tests green) | A half-landed upstream feature: a non-conflicting file imports X, but the conflicted file that exports X auto-resolved to desktop's copy and dropped it | Port the dropped export into the forked file so the fork owns a building version (issue #21 / PR #20 email-auth). Check the E2E/build job, not just unit tests |

## Architecture

### Three Feed Modes
The app has three modes selected via dropdown in the header:
- **Album** - Music album RSS feeds with tracks
- **Video** - Video feed RSS (similar structure to Album)
- **Publisher** - Label/publisher catalog feeds that aggregate multiple album feeds

### Dual Environment: Web vs Desktop
The app runs both as a web app (Vercel) and desktop app (Tauri). Code detects the environment via `window.__TAURI__`:
- **Web:** Uses NIP-07 browser extensions for Nostr signing, browser localStorage for persistence
- **Desktop:** Uses Rust backend via `invoke()` for Nostr (key management, signing, relay publishing), Blossom uploads, and local file system storage

Tauri-specific wrappers provide the same API surface as web equivalents:
- `tauriNostr.ts` - Drop-in replacement for NIP-07 browser extension calls
- `tauriBlossom.ts` - Blossom uploads via Rust backend (SHA256 hashing, auth events)
- `localFeedStorage.ts` - Feed persistence as plain XML files in app data directory

Login is handled by `NostrConnectModal.tsx` which supports all flows (nsec, remote signer, browser extension) in both web and desktop environments.

The Rust backend (`src-tauri/src/main.rs`) exposes Tauri commands for Nostr auth, feed storage, and Blossom operations, using `nostr-sdk` and thread-safe `Mutex<Option<T>>` state.

### Local Feed Storage (Desktop-only)
Feeds are stored as plain XML files in the app data directory (`com.podtards.msp-studio/feeds/`). No metadata sidecars — title and feed type are extracted directly from XML content, timestamps come from file modification time.

- **Filenames**: Human-readable, sanitized from feed title (e.g., `My_Album.xml`), deduplicated with `_2`, `_3` suffixes
- **Feed type detection**: Checks `<podcast:medium>` element content (not `medium=` attributes on other elements)
- **Drop-in import**: Any `.xml` file placed in the feeds folder is automatically detected and listed
- **Rust commands**: `save_feed_local`, `load_feed_local`, `list_feeds_local`, `delete_feed_local`
- **Legacy support**: Old `.json` format files are still readable but not created

### Feed Sidebar (Desktop-only)
`FeedSidebar.tsx` provides a collapsible sidebar for quick feed switching. Only rendered when `hasLocalStorage()` returns true (desktop check).

- Toggle button in header (hidden on screens < 768px)
- Refreshes feed list on open and when `sidebarRefreshKey` increments (after saves)
- Loading a feed from sidebar checks `isDirty` state and prompts before switching
- Active feed highlighted via `currentLocalFeedId` (the filename slug)
- **Delete**: Two-click pattern (× → Confirm?) with `deleteFeedLocal()`. Deleting the active feed clears `currentLocalFeedId` via `onDeleteFeed` callback

### State Management
Uses React Context + useReducer pattern (not Redux). Four separate stores:
- `feedStore.tsx` - Main feed state with album/video/publisher data, persisted to localStorage. Auto-save is debounced (400ms localStorage, 1s desktop filesystem) with a synchronous `pagehide`/`beforeunload` flush so rapid edits don't thrash storage but nothing is lost on quit
- `nostrStore.tsx` - Nostr authentication state
- `themeStore.tsx` - Dark/light theme
- `experimentalStore.tsx` - "Show Experimental Features" toggle (localStorage key `msp-show-experimental`, default off); gates the Import Modal's "Nostr Event 🧪" and "From Nostr 🧪" sources. The toggle lives in the header dropdown. Any component calling `useExperimental()` requires `ExperimentalProvider` in `App.tsx` — upstream changes that consume this hook in shared components will crash desktop if the provider wiring is dropped in a sync.

Actions are dispatched via reducer pattern. The `FeedAction` union type in `feedStore.tsx` defines all available actions. The `feedReducer`, `FeedState`, and `initialState` are exported for direct testing.

### Core Data Types (src/types/feed.ts)
- `Album` - Feed metadata + array of `Track`s, includes optional `artistNpub`
- `Track` - Individual items with optional per-track value recipients
- `Person` - Contributors with roles (uses Podcasting 2.0 taxonomy)
- `ValueRecipient` - Lightning payment recipient with split percentage (type: `node` or `lnaddress`)
- `PublisherFeed` - Contains `RemoteItem`s referencing other feeds
- `RemoteItem` - Reference to another feed by GUID/URL

Factory functions: `createEmptyRecipient()` (defaults to `lnaddress`), `createSupportRecipients()` (MSP 2.0 + Podcast Index community support splits)

### ValueBlock & Community Support
- Recipients are split into **user recipients** and **community support recipients** (MSP 2.0, Podcast Index)
- Community support recipients are auto-added when a user fills in their first recipient address
- `RecipientsList.tsx` renders these in separate sections; community support recipients show as non-removable
- The `isSupportRecipient()` helper identifies community support entries by name+address match
- Artist Npub is stored via `podcast:txt purpose="npub"` in XML output

### API Layer (api/)
Vercel serverless functions (the desktop dev server proxies `/api/*` to `musicsideproject.com`, so the desktop client never runs these locally):
- `pisearch.ts` - Podcast Index search
- `pisubmit.ts` - Submit feed to Podcast Index
- `pubnotify.ts` - Podcast Index pub-notify + add/byfeedurl + optional Podping pass-through
- `podping.ts` - Self-hosted hivepinger broadcast endpoint (rate-limited, gated on env vars)
- `proxy-feed.ts` - CORS proxy for fetching external feeds. **This divergence is over:** the web repo dropped its 17-domain allowlist in August 2026 (it was 403ing every self-hosted musician) and replaced it with six guards, which desktop now shares — per-hop `assertPublicHttpUrl`, a hard byte cap, a feed-shape sniff before any byte is written, no forwarded client headers, a forced `application/xml` content-type (echoing upstream `text/html` would be stored XSS on our own origin), and a per-IP rate limit. Both repos now allow any public host. The one desktop-specific piece is CORS: it goes through `_utils/cors.ts` rather than the web repo's inline origin list, because the Tauri origins must stay allowed.
- `example-feed.ts` - Reference example feed endpoint
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)
- `_utils/feedUtils.ts` - `notifyPodcastIndex()` and `notifyPodping()` helpers shared across endpoints
- `_utils/podcastIndex.ts` - Podcast Index auth + request signing
- `_utils/cors.ts` - Origin allowlist for state-changing endpoints. Must keep `tauri://localhost` (macOS) and `http://tauri.localhost` (Windows) allowed or the desktop app breaks — the Windows webview enforces CORS. Public read-only GETs (proxy-feed, example-feed, pisearch, hosted feed XML) stay wildcard
- `_utils/urlSafety.ts` - SSRF protection for user-supplied URLs (`getExternalUrlError`, `fetchPublicUrl` with per-hop redirect validation)
- `_utils/rateLimiter.ts` - In-memory IP rate limiter for `/api/podping`; `getClientIp` prefers Vercel-set headers (`x-vercel-forwarded-for`, `x-real-ip`) over spoofable `x-forwarded-for`
- `_utils/xmlUtils.ts` - `extractPodcastMedium()` for routing music vs podcast podping reasons
- `_utils/adminAuth.ts` - Admin pubkey verification

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- **Draft mode**: the Save Modal's "Draft mode" checkbox sends `isDraft: true`, which hosts the feed but skips PI notification and podping; the draft flag lives in the feed's `.meta.json` and shows as a DRAFT badge in the modal. Unchecking it on a later save publishes normally
- Hosted XML is validated for well-formedness (`isWellFormedRss` in `api/_utils/xmlUtils.ts`) on create and update, after the 1MB size check
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements, parses `podcast:txt` for artist npub
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML, emits `podcast:txt purpose="npub"` when artistNpub is set

### Nostr Integration
- NIP-07 browser extension support for signing (web)
- NIP-46 remote signer support (Primal, Amber, etc.). The client transport key persists in localStorage on purpose — `reconnectNip46()` needs it across restarts. On startup, a reconnect *timeout* keeps the session alive (the signer reconnects on the next signing op via `checkSignerConnection()`); only an auth error (cleared bunker pointer) logs the user out
- Native key management on desktop (nsec/hex via Tauri secure storage)
- **Kind 30054** — entire RSS XML stored as a Nostr event for personal cross-device sync (`saveFeedToNostr` / `loadAlbumsFromNostr`, `d`-tag = `podcastGuid`)
- **Kind 36787** — Nostr Music track publishing (`publishNostrMusicTracks`)
- **Kind 34139** — Nostr Music playlist event grouping the kind 36787 tracks
- **Kind 5** — NIP-09 deletion events for the "Unpublish" button (`deleteNostrMusicTracks` in `nostrSync.ts`)
- **Kind 1063** — NIP-94 file metadata pointer registered after a Blossom upload so the stable URL is discoverable on relays
- **Kind 24242** — BUD-01 Blossom upload auth events
- **NIP-71 naddr video resolution** — paste handler in `components/Editor/TracksSection.tsx` (Video mode only), implementation in `utils/nostrVideoConverter.ts` (`isNaddrString`, `resolveNostrVideo`). Pasting an `naddr1...` into the Video URL field auto-fills URL, MIME type, and duration.
- Blossom server uploads for file hosting

### Save Modal Destinations
The Save Modal destination dropdown in `SaveModal.tsx` exposes these options. Subscribable means a podcast app can subscribe to the resulting URL and receive updates.

| Destination | Storage | Subscribable | Notes |
|-------------|---------|--------------|-------|
| Save to Computer / Local Storage | App data folder (Tauri) or browser localStorage | No | Per-machine only; fronts the desktop sidebar |
| Download XML | User filesystem | No | One-shot file export |
| Copy to Clipboard | Clipboard | No | One-shot text copy |
| Host on MSP | Vercel Blob via `/api/hosted/*` | Yes (`musicsideproject.com/api/hosted/{id}.xml`) | Triggers `pubnotify` and Podping (unless "Draft mode" is checked); can link a Nostr identity for token-free edits |
| Submit to Podcast Index | n/a (POST `/api/pubnotify`) | n/a | Notifies an already-published URL so PI re-crawls it |
| Send Podping | n/a (POST `/api/podping`) | n/a | Self-hosted hivepinger broadcast; rate-limited |
| Save RSS feed to Nostr | Kind 30054 event | No (sync only) | Personal cross-device load; requires login |
| Publish to Nostr Music | Kind 36787 + 34139 events | Yes (Nostr music clients) | Tracks + playlist; pairs with kind 5 unpublish; requires login |
| Publish RSS feed to a Blossom server | Blossom + kind 1063 pointer | Yes (`/api/feed/{npub}/{podcastGuid}.xml`) | Stable MSP URL always resolves to latest; requires login |

The Save Modal's help (info icon) panel mirrors these descriptions — keep both in sync when editing.

**Known gap:** the web repo has an `nsite` destination (publish to an nsite gateway). `src/utils/nsite.ts` is present here but unwired — no `SaveMode` entry, no state, no panel — so the sync's `case 'nsite'` is deliberately not carried over. Wiring it is a feature addition, not a sync reconcile.

**Reachability guard.** Every path that hands a URL to Podcast Index or Podping (`pisubmit`, `pubnotify`, `podping`) runs `guardFeedSubmission` first, and the matching UI (`SaveModal`, `PodpingModal`, `CatalogFeedsSection`, `DownloadCatalogSection`, `Editor`) checks `verifyFeedUrl` before submitting. A refusal is advisory: it arms a latch so a second click sends `force: 1` and the button reads "Submit anyway". The point is to stop reporting success for a feed crawlers can't fetch — PI keeps such an entry forever as a permanently blank record.

**`apiFetch`, not `fetch`.** A packaged Tauri build has no same-origin `/api`, so every API call must go through `apiFetch` (`src/utils/api.ts`). Upstream writes plain `fetch('/api/…')`, so each sync re-introduces calls that work on the web and silently fail in the desktop app — converting them is part of reconciling any sync that touches a file with an API call. Several stragglers remain (`src/utils/emailSession.ts`, `PublisherFeedReminderSection.tsx`, `Editor.tsx`); grep `fetch('/api` before assuming a feature works on desktop.

## Boundaries

- TypeScript strict mode enabled
- `noUnusedLocals`, `noUnusedParameters` enforced
- ES modules only (`"type": "module"`)
- Target ES2022

## Git Workflow

- **Run `git pull` on startup** before beginning any work
- Main branch: `master`
- Commit style: imperative tense ("Fix bug", "Add feature")
- Include Co-Authored-By for Claude-assisted commits
- No pre-commit hooks configured

### GitHub Issues
Check GitHub issues for feature requests and bug reports:
```bash
gh issue list              # List open issues
gh issue view <number>     # View issue details
```

## Key Patterns

### Component Structure
- Modal-based dialogs (`components/modals/`) using `ModalWrapper` for consistent styling, Escape key support, dialog ARIA semantics, and a Tab focus trap (focus moves into the modal on open)
- Collapsible sections using `Section.tsx`
- **Editor (Album/Video)**: `Editor.tsx` is a thin composition file that imports section components:
  - `CreditsSection.tsx` - Person/role management with thumbnail previews
  - `PublisherLookupSection.tsx` - Podcast Index publisher lookup with debounce
  - `TracksSection.tsx` - Track list with collapse/expand, per-track value recipients
  - `modals/RolesModal.tsx` - Podcasting 2.0 roles reference grid
- **Editor (Publisher)**: `PublisherEditor/index.tsx` follows the same thin-composition pattern
- `FeedSidebar.tsx` - Desktop-only collapsible sidebar for local feed switching
- `InfoIcon` component accepts `position` prop (`"right"` default, `"left"` for edge fields)
- App layout: header → `app-body` (flex row: sidebar + `app-content`) → `bottom-toolbar`

### Header & Bottom Toolbar
The 5 most-common actions live on the **bottom toolbar** (matches the web layout), all with emoji icons: 📂 New, 📥 Import, 💾 Save, 📡 Podping, 👁️ View Feed. The former Podcast Index toolbar button was removed to match upstream — manual PI submission is now the "Submit to Podcast Index" destination in the Save Modal. CSS classes `.bottom-toolbar*` are at `src/App.css:906-956` with mobile rules at `:1452-1462`.

The **header dropdown** (☰ button) holds settings/info-style items only — Info, Overview videos, Theme toggle, "Show/Hide Experimental Features" toggle, "Check for Updates" (Tauri-only), Switch Account / Sign In/Out, dev-only Test Data, version footer. Adding a new common action: prefer the toolbar; reserve the dropdown for things you don't want in the user's main eyeline.

### New Feed Flow
The 📂 **New** toolbar button calls `handleNew(state.feedType)`, which opens a `ConfirmModal` warning that current data will be cleared. On confirm, `handleConfirmNew` clears `pendingHostedStorage` and dispatches `SET_PUBLISHER_FEED` / `SET_VIDEO_FEED` / `SET_ALBUM` with the appropriate `createEmpty*` factory.

(The `NewFeedChoiceModal.tsx` file ships from upstream with a "Start Blank" / "Use Template" choice flow, but desktop uses the simpler `ConfirmModal` path and does not import it. If template-import UX is wanted, wire `NewFeedChoiceModal` into `App.tsx` and add the `templateMode` prop on `ImportModal`.)

### Accessing Nostr State
Use the `useNostr` hook to access logged-in user info:
```tsx
const { state: nostrState } = useNostr();
if (nostrState.isLoggedIn && nostrState.user?.npub) {
  // User is logged in, can access nostrState.user.npub
}
```

### Adding New Fields
1. Add to type definition in `types/feed.ts`
2. Add to `createEmpty*` factory function
3. Add action type to `FeedAction` union in `feedStore.tsx`
4. Handle in reducer switch statement
5. Add UI component and dispatch calls
