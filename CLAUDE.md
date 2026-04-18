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
npm run dev          # Start Vite dev server (proxies /api to msp.podtards.com)
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

Unit tests use Vitest with jsdom, configured in `vitest.config.ts`. Test files live alongside source as `*.test.{ts,tsx}`. Key test files:
- `feedStore.test.ts` - Reducer unit tests (all action types, community support auto-add logic)
- `xmlParser.test.ts` - Parser tests (parseRssFeed, parsePublisherRssFeed, feed type detection)
- `xmlGenerator.test.ts` - Generator tests (publisher reference output)

E2E tests are in `e2e/` and run Playwright against Chrome at multiple viewports (desktop, tablet 1024px, mobile 768px, mobile 480px). Config in `playwright.config.ts`.

### CI/CD
Push to `master` or PR triggers three parallel GitHub Actions jobs: unit tests, E2E tests, and lint.

Every push to `master` also triggers cross-platform release builds (macOS arm64/x86_64, Ubuntu, Windows) that auto-increment the version, sign artifacts, and publish a GitHub release. Multiple pushes in a day each produce a new release.

A daily sync workflow (`sync-upstream.yml`) fetches changes from the [web repo](https://github.com/ChadFarrow/MSP-2.0) and opens a PR via `peter-evans/create-pull-request`. Runs once daily at 6 AM UTC or on manual dispatch (`gh workflow run sync-upstream.yml`).

**Conflict handling — important:** when an upstream change conflicts with desktop's version, the workflow auto-resolves by **keeping the desktop version** and silently drops the upstream change for that file. The PR description lists the conflicted files, but no porting happens automatically. After every sync merge:
1. Read the "Merge conflicts were auto-resolved" list in the PR description
2. For each file, run `git diff <merge-base>..upstream/master -- <file>` (find the merge-base with `git merge-base origin/master upstream/master` *before* merging the sync PR)
3. Open a follow-up PR porting any features that were dropped (see PRs #13, #14, #15 for examples — Podping integration, bottom toolbar, NIP-71 naddr handler all had to be ported manually after a single sync)

## Deployment

### Web Version
- Hosted on Vercel at msp.podtards.com
- API functions in `/api/` directory are Vercel serverless functions
- Dev server proxies `/api/*` to production via Vite config
- Build: `npm run build` (tsc + vite)

### Desktop App (Auto-Update System)
The desktop app uses Tauri's updater plugin with signed releases hosted on GitHub.

**Key files:**
- `src/utils/updater.ts` - Update check and install logic
- `src/components/modals/UpdateModal.tsx` - Update prompt UI
- `src-tauri/tauri.conf.json` - Updater config with public key and endpoint

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
Uses React Context + useReducer pattern (not Redux). Three separate stores:
- `feedStore.tsx` - Main feed state with album/video/publisher data, persisted to localStorage
- `nostrStore.tsx` - Nostr authentication state
- `themeStore.tsx` - Dark/light theme

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
Vercel serverless functions (the desktop dev server proxies `/api/*` to `msp.podtards.com`, so the desktop client never runs these locally):
- `pisearch.ts` - Podcast Index search
- `pisubmit.ts` - Submit feed to Podcast Index
- `pubnotify.ts` - Podcast Index pub-notify + add/byfeedurl + optional Podping pass-through
- `podping.ts` - Self-hosted hivepinger broadcast endpoint (rate-limited, gated on env vars)
- `proxy-feed.ts` - CORS proxy for fetching external feeds
- `example-feed.ts` - Reference example feed endpoint
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)
- `_utils/feedUtils.ts` - `notifyPodcastIndex()` and `notifyPodping()` helpers shared across endpoints
- `_utils/podcastIndex.ts` - Podcast Index auth + request signing
- `_utils/rateLimiter.ts` - In-memory IP rate limiter for `/api/podping`
- `_utils/xmlUtils.ts` - `extractPodcastMedium()` for routing music vs podcast podping reasons
- `_utils/adminAuth.ts` - Admin pubkey verification

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements, parses `podcast:txt` for artist npub
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML, emits `podcast:txt purpose="npub"` when artistNpub is set

### Nostr Integration
- NIP-07 browser extension support for signing (web)
- NIP-46 remote signer support (Amber, etc.)
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
| Host on MSP | Vercel Blob via `/api/hosted/*` | Yes (`msp.podtards.com/feeds/{id}.xml`) | Triggers `pubnotify` and Podping; can link a Nostr identity for token-free edits |
| Submit to Podcast Index | n/a (POST `/api/pubnotify`) | n/a | Notifies an already-published URL so PI re-crawls it |
| Send Podping | n/a (POST `/api/podping`) | n/a | Self-hosted hivepinger broadcast; rate-limited |
| Save RSS feed to Nostr | Kind 30054 event | No (sync only) | Personal cross-device load; requires login |
| Publish to Nostr Music | Kind 36787 + 34139 events | Yes (Nostr music clients) | Tracks + playlist; pairs with kind 5 unpublish; requires login |
| Publish RSS feed to a Blossom server | Blossom + kind 1063 pointer | Yes (`/api/feed/{npub}/{podcastGuid}.xml`) | Stable MSP URL always resolves to latest; requires login |

The Save Modal's help (info icon) panel mirrors these descriptions — keep both in sync when editing.

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
- Modal-based dialogs (`components/modals/`) using `ModalWrapper` for consistent styling + Escape key support
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
The 6 most-common actions live on the **bottom toolbar** (matches the web layout): 📂 New, 📥 Import, 💾 Save, 🔵 Podcast Index, 📡 Podping, 👁️ View Feed. The Podcast Index button uses an `<img>` with `src/assets/podcast-index-logo.svg`; the others use emoji icons. CSS classes `.bottom-toolbar*` are at `src/App.css:906-956` with mobile rules at `:1452-1462`.

The **header dropdown** (☰ button) holds settings/info-style items only — Info, Overview videos, Theme toggle, "Check for Updates" (Tauri-only), Switch Account / Sign In/Out, dev-only Test Data, version footer. Adding a new common action: prefer the toolbar; reserve the dropdown for things you don't want in the user's main eyeline.

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
