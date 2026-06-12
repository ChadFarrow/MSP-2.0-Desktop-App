# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token
- `MSP_ADMIN_PUBKEYS` - Admin public keys for authentication
- `VITE_CANONICAL_URL` - Canonical URL for the application
- `PODPING_ENDPOINT_URL` - Full URL to MSP's self-hosted podping-hivepinger Railway service, trailing slash (optional; podping notifications are skipped when unset)
- `PODPING_BEARER_TOKEN` - Bearer token shared with the Railway service (optional; podping notifications are skipped when unset)

No `.env.example` exists - request credentials from the team.

### Getting Started
```bash
npm install
npm run dev
```

## Deployment

- Hosted on Vercel at msp.podtards.com
- API functions in `/api/` directory are Vercel serverless functions
- Dev server proxies `/api/*` to production
- Build: `npm run build` (tsc + vite)
- Build auto-unshallows Vercel's git clone for accurate version computation

### Versioning
Version is auto-computed at build time from git commit count: `0.1.{count - 255}` (zero-padded). Each push to master increments the patch number. Configured in `vite.config.ts` via `getAutoVersion()`, with `package.json` version as fallback when git is unavailable. Displayed in the hamburger menu.

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
- **Fork divergence gotcha**: the Desktop App's `src/App.tsx` is a fork (adds Tauri integration, FeedSidebar, stored-key auto-unlock, update checks, etc.) and lives in a different shape than upstream. The auto-sync git-merges file *deletions* cleanly but **cannot reconcile in-file edits** when the surrounding context differs. Concretely: if you delete an import + a toolbar button + a modal render from `src/App.tsx` here, the Desktop App's sync PR will pull in the deleted asset but leave its own (forked) `App.tsx` still referencing it, breaking the Vite build. When making cross-cutting App.tsx surgery upstream, expect to push a matching follow-up commit to the Desktop App's `sync-upstream` branch (or fix the merge conflict before merging the sync PR). Once the sync PR merges to `master` on the Desktop App side, its `Build & Release` workflow (`.github/workflows/release.yml`, Tauri matrix for macOS aarch64/x64, Ubuntu, Windows) fires and publishes a GitHub Release plus the auto-updater `latest.json`.

## GitHub Issues

Check GitHub issues for feature requests and bug reports:
```bash
gh issue list              # List open issues
gh issue view <number>     # View issue details
```

## Commands

```bash
npm run dev          # Start Vite dev server (proxies /api to msp.podtards.com)
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
- `proxy-feed.ts` - CORS proxy for fetching external feeds. Enforces an `allowedDomains` allowlist (SSRF guard) and rejects private/loopback/link-local hosts — adding a new external feed host means adding its domain to that array, or the proxy returns 403.
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)
- `_utils/podcastIndex.ts` - Shared Podcast Index auth headers
- `_utils/feedUtils.ts` - Shared feed utilities (PI notification, podping notification, `isPodpingConfigured()` helper, UUID validation, token hashing)
- `_utils/rateLimiter.ts` - In-memory fixed-window IP rate limiter used by `/api/podping`
- `_utils/xmlUtils.ts` - RSS XML helpers (`extractPodcastMedium()` — used by hosted POST/PUT before podping broadcast)
- `_utils/adminAuth.ts` - Nostr NIP-98 auth verification, `NostrEvent` type
- `_utils/urlValidation.ts` - `getFeedUrlError()` — flags spaces, apostrophes (PI encodes `'` as `%27` and creates duplicate feed entries), special chars, non-ASCII. Mirror of `src/utils/urlValidation.ts` (Vercel functions can't import from `src/`, so the rule table is intentionally duplicated — keep in sync). Enforced on every PI/podping submission path: inline in `/api/pubnotify`, `/api/pisubmit`, `/api/podping` (backend guard); on the frontend before submit in `SaveModal` (Submit to PodcastIndex mode), `PodpingModal`, `Editor` publisher-URL field, `PublisherFeedReminderSection`, `CatalogFeedsSection`. Any new manual feed-URL input that submits to PI/podping should add a `getFeedUrlError()` check before enabling its submit button.

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **Manual PI submission**: the SaveModal's "Submit to PodcastIndex" destination and `PublisherFeedReminderSection` (self-hosted URL field) both call `/api/pubnotify` for feeds not hosted on MSP. The previous standalone `PodcastIndexModal` toolbar button was folded into the SaveModal dropdown — there is no longer a separate top-level modal.
- `pubnotify.ts` does pubnotify ping, GUID/URL lookup, then `add/byfeedurl` for new feeds — returns PI page URL for immediate user feedback
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed
- **Podping**: `notifyPodcastIndex()` fire-and-forgets `notifyPodping()` after the PI pubnotify ping. Sends `GET ${PODPING_ENDPOINT_URL}?url=...` with `Authorization: Bearer ${PODPING_BEARER_TOKEN}`. The endpoint is MSP's self-hosted [podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger) deployment on Railway (repo: `ChadFarrow/msp-podping-service`), fronted by a Caddy sidecar enforcing the bearer token. Silently no-ops when either env var is unset (`isPodpingConfigured()` in `api/_utils/feedUtils.ts` is the canonical gate). The fire-and-forget call site uses a `.then()` that `console.warn`s on failure so Vercel function logs surface hivepinger outages. `/api/podping` exposes a manual endpoint behind a 10/hour per-IP rate limit. `/api/pubnotify` also fires a podping (same fire-and-forget pattern) so the "Podcast Index" toolbar button hits both indexing pathways. UI entry point for a pure podping (no PI call): the standalone **Podping** button on the bottom toolbar (`PodpingModal.tsx` — opens a mini modal with just a URL field + submit, `reason` is hardcoded to `'update'`). The SaveModal previously had a "Send Podping" destination; it was removed in favor of the dedicated toolbar button.
- **Podping `medium` — load-bearing**: hivepinger uses the `medium` value to build the custom_json op id as `pp_<medium>_<reason>` (e.g. `pp_music_update`). The companion consumer in `msp-podping-service` filters `pp_music_*` only, so any code path that fires a podping WITHOUT a medium ends up as `pp_podcast_update` (hivepinger's default) and is invisible to the consumer. Every client path that can trigger a podping passes medium: hosted POST/PUT (extracted via `extractPodcastMedium()` from the XML), SaveModal's nsite follow-up and "Submit to PodcastIndex" destination (`album.medium` / `publisherFeed.medium`), `publisherPublish.ts`'s internal `notifyPodcastIndex()` helper (takes a `medium` param forwarded to `/api/pubnotify`), PublisherFeedReminderSection (`publisherFeed.medium`). The PodpingModal toolbar button reads medium from the feed (`album.medium` / `videoFeed.medium` / `publisherFeed.medium`), matching the SaveModal pattern. Publisher feeds carry `medium: 'publisher'` which produces `pp_publisher_update` — still filtered out by the music-only consumer, preserving the prior intent without special-casing. When adding a new podping trigger, always plumb through the feed's medium — the `isPodpingConfigured()` gate + `notifyPodping(url, { medium })` signature is the canonical call site pattern.

### Save Modal Destinations
The Save modal (`src/components/modals/SaveModal.tsx`) offers nine destinations. Each is a different combination of *where the bytes live* and *who can consume them* — important context when deciding which one to point a user at:

| Destination | What gets published | Storage | Subscribable in podcast apps? |
|---|---|---|---|
| Local Storage | Album/Video/Publisher state | Browser localStorage | No |
| Download XML | Generated RSS XML | User's filesystem | No |
| Copy to Clipboard | Generated RSS XML | Clipboard | No |
| Host on MSP | Generated RSS XML | Vercel Blob (`feeds/{feedId}.xml`) | Yes — `https://msp.podtards.com/api/hosted/{feedId}` |
| Submit to PodcastIndex | Feed URL (not the bytes) submitted to PI via `/api/pubnotify` | — (registration only) | Indirectly — PI indexes the URL so apps like Fountain/Castamatic can discover it |
| Save RSS feed to Nostr | Full RSS XML embedded in a kind 30054 event | Nostr relays only | No — only MSP reads kind 30054 (cross-device sync) |
| Publish to Nostr Music | Per-track events (kind 36787) + playlist event (kind 34139) | Nostr relays | No — Nostr-native music clients only (Wavlake, Fountain, etc.). Audio files must already be hosted elsewhere; the events just reference enclosure URLs |
| Publish RSS feed to a Blossom server | Generated RSS XML | Blossom server (content-addressed) + kind 1063 NIP-94 pointer event on Nostr | Yes — `${origin}/api/feed/{npub}/{podcastGuid}.xml` resolves the pointer and 302s to the latest Blossom URL |
| Publish RSS feed to nsite | Generated RSS XML | Blossom server + NIP-5A site manifest (kind 35128) | Yes — via any nsite gateway URL |

Login-gated options (everything from "Save RSS feed to Nostr" down) are conditionally rendered on `isLoggedIn` — they don't appear in the dropdown for logged-out users. The help popup (ℹ️ next to the modal title) lists all nine with the same wording so help and dropdown stay in sync — keep them aligned when adding/renaming destinations. Podping has its own dedicated bottom-toolbar button (`PodpingModal.tsx`) and is no longer a SaveModal destination. "Submit to PodcastIndex" handles manual PI submission directly in the SaveModal — the previous standalone toolbar button (`PodcastIndexModal`) has been removed.

Most experimental/power-user options are additionally gated behind a "Show Experimental Features" toggle in the hamburger menu (`src/store/experimentalStore.tsx`, localStorage key `msp-show-experimental`, default off). With the toggle off, the Save modal dropdown collapses to the production-ready set: Local Storage, Download XML, Copy to Clipboard, Host on MSP, Submit to PodcastIndex, and (when logged in) Publish to Nostr Music. The Import modal applies the same gate to "Nostr Event" and "From Nostr." When adding a new experimental destination/import source: gate it with `showExperimental` from `useExperimental()`, suffix the visible label with a trailing ` 🧪` marker, sort it to the bottom of its dropdown and help-list (after all non-experimental options), and add a mode-reset `useEffect` so the dropdown snaps back to a safe default if the user flips the toggle off mid-flow. The experimental store follows the same Provider+`useX()`-in-one-file pattern as the other stores (`themeStore`, `feedStore`, `nostrStore`); `eslint.config.js` carves out `react-refresh/only-export-components` for `src/store/*.{ts,tsx}` since these are plumbing files, not fast-refresh-sensitive UI.

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements, detects and strips OP3 prefixes on import
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML, applies OP3 prefix to enclosure URLs when enabled

#### Value recipient normalization on import
`parseRecipient()` in `xmlParser.ts` does not trust the feed's `<podcast:valueRecipient>` `type` attribute — it normalizes every recipient at parse time (the single choke point covering channel- and track-level value blocks):
- **Type detection**: type is derived from the address via `detectAddressType()` (`src/utils/addressUtils.ts`) — an `@` in the address means `lnaddress`, otherwise `node`. Feeds from older node-only tools (the original musicsideproject.com) wrote `type="node"` even for Lightning addresses; this fixes them on import. Mirrors the editor's auto-detection on manual address edit (`RecipientsList.tsx`).
- **Legacy MSP migration**: a recipient whose address equals `LEGACY_MSP_NODE_PUBKEY` (`types/feed.ts`, the MSP 1.0 support node pubkey) is swapped to the MSP 2.0 lnaddress identity (`MSP_SUPPORT_RECIPIENT` = `MSP 2.0` / `chadf@getalby.com`), **preserving the existing split** and dropping keysend-only `customKey`/`customValue`. Matches on the pubkey (unique, unforgeable), not the name. `LEGACY_MSP_NODE_PUBKEY` / `MSP_SUPPORT_RECIPIENT` in `types/feed.ts` are the single source of truth.
- Tests in `xmlParser.test.ts` cover type detection, the legacy migration (swap, split preservation, case-insensitive match, track-level coverage), and round-trip to `method="lnaddress"` output.

### OP3 Analytics
- [OP3](https://op3.dev/) (Open Podcast Prefix Project) provides open, privacy-respecting download stats
- Toggle in Album Info enables/disables OP3 prefix on enclosure URLs
- `Album.op3` boolean field controls prefix generation
- Generator (`xmlGenerator.ts`): `applyOp3Prefix()` prepends `https://op3.dev/e,pg={podcastGuid}/` to enclosure URLs (strips `https://` from target, keeps `http://`)
- Parser (`xmlParser.ts`): `stripOp3Prefix()` detects and removes OP3 prefix on import, sets `album.op3 = true`
- Stats link shown in Save modal (hosted section) — OP3 needs a few days of downloads before stats page is available
- Tests in `xmlGenerator.test.ts` and `xmlParser.test.ts` cover prefix generation, stripping, and round-trip

### Nostr Integration
- NIP-07 browser extension support for signing
- NIP-46 remote signer support
- **Kind 30054** — full RSS XML embedded in a parameterized-replaceable event (`d`-tag = `podcastGuid`). Used by "Save RSS feed to Nostr" for personal cross-device sync. Read back via `loadAlbumsFromNostr` in `src/utils/nostrSync.ts`
- **Kind 36787 + 34139** — Nostr Music track events and playlist event. Published via `publishNostrMusicTracks` in `src/utils/nostrSync.ts:648`, imported via `fetchNostrMusicTracks` at `:384`. These three functions (plus `deleteNostrMusicTracks`) default to `MUSIC_RELAYS` rather than `DEFAULT_RELAYS` — `MUSIC_RELAYS` (defined in `src/utils/nostrRelay.ts`) is `DEFAULT_RELAYS` + `wss://drops.basspistol.org`, a public relay that only accepts music kinds and would reject kind 0/30054/1063 traffic if we sent it there. Kind 36787 is a lossy format — it carries no description/file-size/required-duration — so the SaveModal validator skips those requirements in `nostrMusic` mode to let round-tripped albums republish. Field-by-field mapping between RSS output and these events (useful when building converters or reasoning about what survives a round-trip) is in `docs/rss-nostr-music-crossref.md`.
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
