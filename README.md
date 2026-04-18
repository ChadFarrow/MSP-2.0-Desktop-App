# MSP 2.0 Desktop App - Music Side Project Studio

A cross-platform desktop application for creating Podcasting 2.0 compatible music album feeds, video feeds, and publisher catalogs with Value 4 Value support.

Built with [Tauri](https://tauri.app/) for Windows, macOS, and Linux.

> **Note:** This is the desktop version of MSP 2.0. The web version is available at [msp.podtards.com](https://msp.podtards.com) ([source](https://github.com/ChadFarrow/MSP-2.0)).

## Features

### Album & Video Modes
- Create and edit podcast RSS feeds for music albums and video feeds
- Podcasting 2.0 namespace support (podcast:person, podcast:value, podcast:funding, etc.)
- Value 4 Value (V4V) Lightning payment splits
- Per-track value recipient overrides
- Funding links for listener support (Patreon, Ko-fi, etc.)
- Publisher reference linking (connect albums to a publisher feed)
- Import/export feeds as XML

### Publisher Mode
- Create publisher/label catalog feeds
- Manage multiple album feeds under one publisher identity
- Podcast Index integration (search and add feeds by name or GUID)
- Bulk download catalog feeds with publisher references
- Host publisher feeds on MSP with automatic Podcast Index notification
- Nostr identity linking for token-free editing

### Desktop Features
- **Local feed storage** — feeds saved as plain XML files in your app data folder
- **Feed sidebar** — collapsible sidebar for quick switching between locally saved feeds
- **Drop-in import** — place XML files in the feeds folder and they appear in the sidebar automatically
- **Nostr key management** — sign in with nsec/hex key (no browser extension needed)
- **Auto-updates** — signed releases with automatic update prompts

### Integrations
- Nostr cloud sync (NIP-07 browser extension on web, native key management on desktop)
- Nostr Music publishing (kind 36787 track events + kind 34139 playlist) with NIP-09 unpublish
- NIP-71 naddr video resolution (paste an naddr into a Video URL field to auto-fill)
- Podcast Index search and feed submission
- MSP feed hosting with edit tokens
- Blossom server uploads (BUD-01) for file hosting
- OP3 analytics prefix support for privacy-respecting download stats
- Podping broadcasts so indexers re-crawl your feed on update

## Tech Stack

- **Desktop Framework:** Tauri 2.x (Rust backend)
- **Frontend:** React 19 + TypeScript
- **Build Tool:** Vite
- **Nostr:** NIP-07 browser extension support

## Project Structure

```
src/
├── components/
│   ├── Editor/
│   │   ├── Editor.tsx              # Album/video editor
│   │   └── PublisherEditor/        # Publisher mode components
│   ├── modals/
│   │   ├── ImportModal.tsx         # Import feed modal
│   │   └── SaveModal.tsx           # Save options modal
│   ├── FeedSidebar.tsx             # Collapsible local feeds sidebar (desktop)
│   ├── DesktopNostrLogin.tsx       # Desktop Nostr login (nsec/hex)
│   ├── InfoIcon.tsx                # Tooltip component
│   ├── NostrLoginButton.tsx        # Nostr auth button
│   └── Section.tsx                 # Collapsible section
├── store/
│   ├── feedStore.tsx               # Album & publisher state
│   └── nostrStore.tsx              # Nostr auth state
├── types/
│   └── feed.ts                     # Album/track/publisher types
├── utils/
│   ├── localFeedStorage.ts         # Desktop local feed storage (Tauri)
│   ├── tauriNostr.ts               # Desktop Nostr key management
│   ├── tauriBlossom.ts             # Desktop Blossom uploads
│   ├── xmlGenerator.ts             # RSS XML generation
│   └── xmlParser.ts                # RSS XML parsing
├── App.tsx                         # Main app with mode switching
└── App.css                         # Styles

src-tauri/
├── src/
│   └── main.rs                     # Tauri Rust backend (Nostr, feed storage, Blossom)
├── Cargo.toml                      # Rust dependencies
└── tauri.conf.json                 # Tauri configuration
```

## Development

### Prerequisites

- Node.js v22+
- npm
- Rust (for desktop builds) - [Install Rust](https://rustup.rs/)

### Web Development

```bash
npm install
npm run dev
```

### Desktop Development

```bash
npm run tauri:dev    # Start desktop app in dev mode
npm run tauri:build  # Build for distribution
```

## Publisher Mode

Switch to Publisher mode using the dropdown in the header to create a publisher/label catalog feed.

### Creating a Publisher Feed
1. Enter your publisher name and catalog title
2. Add catalog feeds by searching Podcast Index or entering feed GUIDs directly
3. Configure optional value splits and funding links
4. Download catalog feeds with publisher references added

### Publishing to MSP
Once all your catalog feeds are hosted on MSP, the "Publish on MSP" section appears:
1. Host your publisher feed on MSP servers
2. Automatically notify Podcast Index of your publisher feed
3. Add `<podcast:publisher>` references to all catalog feeds

## Local Feed Storage (Desktop)

Feeds are saved as plain XML files in your app data folder:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/com.podtards.msp-studio/feeds/` |
| Linux | `~/.local/share/com.podtards.msp-studio/feeds/` |
| Windows | `%APPDATA%\com.podtards.msp-studio\feeds\` |

Files use human-readable names based on the feed title (e.g., `My_Album.xml`). You can also drop existing RSS XML files into this folder and they'll appear in the sidebar automatically.

## Import Options

- **Upload File** - Upload an RSS/XML feed file from your device
- **Paste XML** - Paste RSS/XML content directly
- **From URL** - Fetch a feed from any URL
- **Nostr Event** - Import from a Nostr Event (kind 36787)
- **MSP Hosted** - Load a feed hosted on MSP servers using its Feed ID
- **From Nostr** - Load your previously saved albums from Nostr (requires login)
- **From Nostr Music** - Import tracks from Nostr Music library (requires login)
- **naddr paste (Video mode)** - Paste a NIP-71 naddr (or a URL containing one) into a Video URL field to auto-resolve URL, MIME type, and duration

## Save Options

- **Save to Computer** - Save feed as XML to your local feeds folder (appears in sidebar)
- **Download XML** - Download the RSS feed as an XML file
- **Copy to Clipboard** - Copy the RSS XML to your clipboard
- **Host on MSP** - Host your feed on MSP servers with a permanent URL
- **Submit to Podcast Index** - Notify Podcast Index about your feed URL
- **Send Podping** - Broadcast a feed-update notification via Podping/Hive so indexers (Podcast Index, Fountain, etc.) re-crawl the feed
- **Save RSS feed to Nostr** - Stores the entire RSS XML inside a Nostr event (kind 30054). Personal sync only — not subscribable by podcast apps (requires login)
- **Publish to Nostr Music** - Publishes each track (kind 36787) and the playlist (kind 34139) so native Nostr music clients can stream the album (requires login)
- **Publish RSS feed to a Blossom server** - Uploads the RSS file to a Blossom server (BUD-01) and registers a Nostr pointer (kind 1063) for it, plus a stable MSP URL that always resolves to your latest upload (requires login)

## Nostr Integration

**Desktop:** Sign in with your nsec or hex private key directly in the app.

**Web:** Sign in with a NIP-07 compatible browser extension (Alby, nos2x, etc.).

Features:
- Save feeds to Nostr relays (kind 30054) for personal cross-device sync
- Load feeds from any device with your Nostr key
- Publish tracks as Nostr Music events (kind 36787) and a playlist (kind 34139)
- Unpublish previously published tracks via NIP-09 (kind 5) deletion events
- Register Blossom uploads with a NIP-94 file metadata pointer (kind 1063)
- Authenticate Blossom uploads with BUD-01 auth events (kind 24242)
- NIP-71 naddr video resolution — paste an naddr into a Video URL field to auto-fill
- Link Nostr identity to hosted feeds for token-free editing

Default relays: `relay.damus.io`, `relay.primal.net`, `nos.lol`, `relay.nostr.band`

## License

MIT
