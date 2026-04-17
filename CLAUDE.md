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
- `pubnotify.ts` - Podcast Index pub notification + feed lookup
- `podping.ts` - Broadcast feed update via self-hosted hivepinger Railway service (requires `PODPING_ENDPOINT_URL` + `PODPING_BEARER_TOKEN`); rate-limited 10/hour per IP
- `proxy-feed.ts` - CORS proxy for fetching external feeds
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)
- `_utils/podcastIndex.ts` - Shared Podcast Index auth headers
- `_utils/feedUtils.ts` - Shared feed utilities (PI notification, podping notification, UUID validation, token hashing)
- `_utils/adminAuth.ts` - Nostr NIP-98 auth verification, `NostrEvent` type

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **Manual PI submission**: `PodcastIndexModal` (standalone bottom toolbar button) and `PublisherFeedReminderSection` (self-hosted URL field) both call `/api/pubnotify` for feeds not hosted on MSP
- `pubnotify.ts` does pubnotify ping, GUID/URL lookup, then `add/byfeedurl` for new feeds — returns PI page URL for immediate user feedback
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed
- **Podping**: `notifyPodcastIndex()` fire-and-forgets `notifyPodping()` after the PI pubnotify ping. Sends `GET ${PODPING_ENDPOINT_URL}?url=...` with `Authorization: Bearer ${PODPING_BEARER_TOKEN}`. The endpoint is MSP's self-hosted [podping-hivepinger](https://github.com/brianoflondon/podping-hivepinger) deployment on Railway (repo: `ChadFarrow/msp-podping-service`), fronted by a Caddy sidecar enforcing the bearer token. Silently no-ops when either env var is unset, so podping is off until both are configured. `/api/podping` exposes a manual endpoint behind a 10/hour per-IP rate limit; the "Send Podping" row in the SaveModal is the UI for it.

### Save Modal Destinations
The Save modal (`src/components/modals/SaveModal.tsx`) offers nine destinations. Each is a different combination of *where the bytes live* and *who can consume them* — important context when deciding which one to point a user at:

| Destination | What gets published | Storage | Subscribable in podcast apps? |
|---|---|---|---|
| Local Storage | Album/Video/Publisher state | Browser localStorage | No |
| Download XML | Generated RSS XML | User's filesystem | No |
| Copy to Clipboard | Generated RSS XML | Clipboard | No |
| Host on MSP | Generated RSS XML | Vercel Blob (`feeds/{feedId}.xml`) | Yes — `https://msp.podtards.com/api/hosted/{feedId}` |
| Send Podping | Feed-update notification | Hive blockchain (via MSP hivepinger) | Indirectly — Podcast Index re-crawls the feed URL |
| Save RSS feed to Nostr | Full RSS XML embedded in a kind 30054 event | Nostr relays only | No — only MSP reads kind 30054 (cross-device sync) |
| Publish to Nostr Music | Per-track events (kind 36787) + playlist event (kind 34139) | Nostr relays | No — Nostr-native music clients only (Wavlake, Fountain, etc.). Audio files must already be hosted elsewhere; the events just reference enclosure URLs |
| Publish RSS feed to a Blossom server | Generated RSS XML | Blossom server (content-addressed) + kind 1063 NIP-94 pointer event on Nostr | Yes — `${origin}/api/feed/{npub}/{podcastGuid}.xml` resolves the pointer and 302s to the latest Blossom URL |
| Publish RSS feed to nsite (experimental) | Generated RSS XML | Blossom server + NIP-5A site manifest (kind 35128) | Yes — via any nsite gateway URL |

Login-gated options (everything from "Save RSS feed to Nostr" down) are conditionally rendered on `isLoggedIn` — they don't appear in the dropdown for logged-out users. The help popup (ℹ️ next to the modal title) lists all nine with the same wording so help and dropdown stay in sync — keep them aligned when adding/renaming destinations.

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements, detects and strips OP3 prefixes on import
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML, applies OP3 prefix to enclosure URLs when enabled

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
- **Kind 36787 + 34139** — Nostr Music track events and playlist event. Published via `publishNostrMusicTracks` in `src/utils/nostrSync.ts:636`
- **Kind 5 (NIP-09)** — deletion request used by the "Unpublish (delete)" button next to "Publish to Nostr Music". `deleteNostrMusicTracks` (`src/utils/nostrSync.ts:729`) builds `a`-tag references for each kind-36787 track event and the kind-34139 playlist; relays *may* honor it. Success message says "Sent deletion request..." rather than "Deleted" to be honest about NIP-09 semantics
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
- **Use Template** — opens `ImportModal` in template mode (`templateMode` prop), which imports a feed with a regenerated GUID and no hosted credentials. Template handlers (`handleTemplateImport`, `handleTemplateLoadAlbum`) in `App.tsx` call `crypto.randomUUID()` for the new GUID and clear `pendingHostedStorage`

### Accessing Nostr State
Use the `useNostr` hook to access logged-in user info:
```tsx
const { state: nostrState } = useNostr();
if (nostrState.isLoggedIn && nostrState.user?.npub) {
  // User is logged in, can access nostrState.user.npub
}
```

### Community Support Recipients
MSP 2.0 and Podcastindex.org are auto-added as value recipients with small splits. Two different behaviors by context:
- **New feeds** (manual entry): `ADD_RECIPIENT`/`UPDATE_RECIPIENT` actions in `feedStore.tsx` auto-append support splits when the first user address is added
- **Imported feeds**: Support splits are NOT auto-added. Instead, `RecipientsList.tsx` shows an "Add Community Support" button in the Value section when user recipients exist but support splits are missing

Key helpers in `types/feed.ts`: `isCommunitySupport()`, `hasUserRecipients()`, `createSupportRecipients()`, `COMMUNITY_SUPPORT_RECIPIENTS`. These are the canonical definitions — imported by both `feedStore.tsx` and `RecipientsList.tsx`.

### Adding New Fields
1. Add to type definition in `types/feed.ts`
2. Add to `createEmpty*` factory function
3. Add action type to `FeedAction` union in `feedStore.tsx`
4. Handle in reducer switch statement
5. Add UI component and dispatch calls
