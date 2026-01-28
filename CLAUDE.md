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

### Getting Started
```bash
npm install
npm run dev          # Web dev server
npm run tauri:dev    # Desktop app dev mode
```

## Deployment

### Web Version
- Hosted on Vercel at msp.podtards.com
- API functions in `/api/` directory are Vercel serverless functions
- Dev server proxies `/api/*` to production
- Build: `npm run build` (tsc + vite)

### Desktop App
- Built with Tauri 2.x
- Supports Windows, macOS, and Linux
- Build: `npm run tauri:build`

### Auto-Update System
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

## Software Versions

### Core
- React 19.2
- TypeScript 5.9
- Vite 7.2

### Key Libraries
- Tauri 2.9
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

src-tauri/          # Tauri desktop app
├── src/            # Rust backend
├── Cargo.toml      # Rust dependencies
└── tauri.conf.json # Tauri configuration
```

## Boundaries

- TypeScript strict mode enabled
- `noUnusedLocals`, `noUnusedParameters` enforced
- ES modules only (`"type": "module"`)
- Target ES2022
- Never commit secrets (`.env`, API keys, tokens)

## Git Workflow

- **Run `git pull` on startup** before beginning any work
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
npm run tauri:dev    # Start Tauri desktop app in dev mode
npm run tauri:build  # Build desktop app for distribution
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
- `hosted/` - MSP feed hosting endpoints
- `feed/[npub]/[guid].ts` - Nostr-stored feed retrieval
- `admin/` - Admin authentication (challenge/verify)

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

### Adding New Fields
1. Add to type definition in `types/feed.ts`
2. Add to `createEmpty*` factory function
3. Add action type to `FeedAction` union in `feedStore.tsx`
4. Handle in reducer switch statement
5. Add UI component and dispatch calls
