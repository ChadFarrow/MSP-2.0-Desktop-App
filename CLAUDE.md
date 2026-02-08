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

Unit tests use Vitest with jsdom, configured in `vitest.config.ts`. Test files live alongside source as `*.test.{ts,tsx}`.

E2E tests are in `e2e/` and run Playwright against Chrome at multiple viewports (desktop, tablet 1024px, mobile 768px, mobile 480px). Config in `playwright.config.ts`.

### CI/CD
Push to `master` or PR triggers three parallel GitHub Actions jobs: unit tests, E2E tests, and lint.

Pushing a version tag (`v*`) triggers cross-platform release builds (macOS arm64/x86_64, Ubuntu, Windows) that sign artifacts and create a draft GitHub release.

A daily sync workflow (`sync-upstream.yml`) fetches changes from the [web repo](https://github.com/ChadFarrow/MSP-2.0) and opens a PR via `peter-evans/create-pull-request`. Runs at 6 AM UTC or on manual dispatch.

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
- `localFeedStorage.ts` - Feed persistence to app data directory instead of localStorage
- `DesktopNostrLogin.tsx` - Login via nsec/hex key instead of browser extension

The Rust backend (`src-tauri/src/main.rs`) exposes Tauri commands for Nostr auth, feed storage, and Blossom operations, using `nostr-sdk` and thread-safe `Mutex<Option<T>>` state.

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
- NIP-07 browser extension support for signing (web)
- NIP-46 remote signer support
- Kind 30054 events for feed storage on relays
- Kind 36787 for Nostr Music track publishing
- Blossom server uploads for file hosting

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
