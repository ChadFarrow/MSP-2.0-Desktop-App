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
- `VERCEL_DEEP_CLONE=true` env var ensures full git history for version computation

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
- `proxy-feed.ts` - CORS proxy for fetching external feeds
- `hosted/` - MSP feed hosting endpoints (create, update, delete, backup/restore)
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)

### Feed Hosting & Podcast Index
- Hosted feeds are stored as Vercel Blobs at `feeds/{feedId}.xml` with metadata in `feeds/{feedId}.meta.json`
- Feeds are **automatically submitted to Podcast Index** on creation (POST) and update (PUT) via `notifyPodcastIndex()` in `api/_utils/feedUtils.ts` — no manual step needed
- The function sends a pubnotify ping (triggers re-crawl) and calls `add/byfeedurl` (registers new feeds, returns PI ID)
- **Backup retention**: `backupFeed()` helper in `api/hosted/[feedId].ts` creates timestamped backups before PUT, DELETE, and restore operations; keeps only the 10 most recent backups per feed

### XML Handling
- `xmlParser.ts` - Uses fast-xml-parser to parse RSS feeds, preserves unknown elements
- `xmlGenerator.ts` - Generates Podcasting 2.0 compliant RSS XML

### Nostr Integration
- NIP-07 browser extension support for signing
- NIP-46 remote signer support
- Kind 30054 events for feed storage on relays
- Kind 36787 for Nostr Music track publishing
- Blossom server uploads for file hosting

## Key Patterns

### Component Structure
- Modal-based dialogs (`components/modals/`)
- Collapsible sections using `Section.tsx`
- Editor components split between Album (`Editor.tsx`) and Publisher (`PublisherEditor/`)
- `InfoIcon` component accepts `position` prop (`"right"` default, `"left"` for edge fields)

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
