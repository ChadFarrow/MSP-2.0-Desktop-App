# MSP 2.0 Desktop App - Music Side Project Studio

A cross-platform desktop application for creating Podcasting 2.0 compatible music album feeds and publisher catalogs with Value 4 Value support.

Built with [Tauri](https://tauri.app/) for Windows, macOS, and Linux.

> **Note:** This is the desktop version of MSP 2.0. The web version is available at [msp.podtards.com](https://msp.podtards.com) ([source](https://github.com/ChadFarrow/MSP-2.0)).

## Features

### Album Mode
- Create and edit podcast RSS feeds for music albums
- Podcasting 2.0 namespace support (podcast:person, podcast:value, podcast:funding, etc.)
- Value 4 Value (V4V) Lightning payment splits
- Per-track value recipient overrides
- Funding links for listener support (Patreon, Ko-fi, etc.)
- Publisher reference linking (connect albums to a publisher feed)
- Import/export feeds as XML
- Local storage persistence

### Publisher Mode
- Create publisher/label catalog feeds
- Manage multiple album feeds under one publisher identity
- Podcast Index integration (search and add feeds by name or GUID)
- Bulk download catalog feeds with publisher references
- Host publisher feeds on MSP with automatic Podcast Index notification
- Nostr identity linking for token-free editing

### Integrations
- Nostr cloud sync (NIP-07 browser extension)
- Podcast Index search and feed submission
- MSP feed hosting with edit tokens
- Blossom server uploads

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
│   │   ├── Editor.tsx              # Album editor
│   │   └── PublisherEditor/        # Publisher mode components
│   │       ├── index.tsx           # Publisher editor layout
│   │       ├── PublisherInfoSection.tsx
│   │       ├── PublisherArtworkSection.tsx
│   │       ├── CatalogFeedsSection.tsx
│   │       ├── PublisherValueSection.tsx
│   │       ├── PublisherFundingSection.tsx
│   │       ├── DownloadCatalogSection.tsx
│   │       └── PublishSection.tsx
│   ├── modals/
│   │   ├── ImportModal.tsx         # Import feed modal
│   │   └── SaveModal.tsx           # Save options modal
│   ├── InfoIcon.tsx                # Tooltip component
│   ├── NostrLoginButton.tsx        # Nostr auth button
│   ├── Section.tsx                 # Collapsible section
│   └── Toggle.tsx                  # Toggle switch
├── store/
│   ├── feedStore.tsx               # Album & publisher state
│   └── nostrStore.tsx              # Nostr auth state
├── types/
│   ├── feed.ts                     # Album/track/publisher types
│   └── nostr.ts                    # Nostr types
├── utils/
│   ├── nostr.ts                    # Nostr utilities
│   ├── nostrSync.ts                # Relay sync (kind 30054)
│   ├── publisherPublish.ts         # Publisher feed hosting
│   ├── xmlGenerator.ts             # RSS XML generation
│   └── xmlParser.ts                # RSS XML parsing
├── data/
│   └── fieldInfo.ts                # Form field tooltips
├── App.tsx                         # Main app with mode switching
└── App.css                         # Styles

api/
├── pisearch.ts                     # Podcast Index search API
├── pisubmit.ts                     # Podcast Index feed submission
├── proxy-feed.ts                   # Feed proxy for CORS
└── hosted/                         # MSP feed hosting endpoints

src-tauri/
├── src/
│   └── lib.rs                      # Tauri Rust backend
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

## Import Options (Album Mode)

- **Upload File** - Upload an RSS/XML feed file from your device
- **Paste XML** - Paste RSS/XML content directly
- **From URL** - Fetch a feed from any URL
- **Nostr Event** - Import from a Nostr Event (kind 36787)
- **MSP Hosted** - Load a feed hosted on MSP servers using its Feed ID
- **From Nostr** - Load your previously saved albums from Nostr (requires login)
- **From Nostr Music** - Import tracks from Nostr Music library (requires login)

## Save Options (Album Mode)

- **Local Storage** - Save to your browser's local storage. Data persists until you clear browser data.
- **Download XML** - Download the RSS feed as an XML file to your computer.
- **Copy to Clipboard** - Copy the RSS XML to your clipboard for pasting elsewhere.
- **Host on MSP** - Host your feed on MSP servers. Get a permanent URL for your RSS feed to use in any app.
- **Save to Nostr** - Publish to Nostr relays. Load it later on any device with your Nostr key (requires login).
- **Publish Nostr Music** - Publish each track as a Nostr Music event (kind 36787) for music clients (requires login).
- **Publish to Blossom** - Upload your feed to a Blossom server. Get a stable MSP URL that always points to your latest upload (requires login).

## Save Options (Publisher Mode)

- **Local Storage** - Save publisher feed to browser storage.
- **Download XML** - Download the publisher catalog feed as XML.
- **Copy to Clipboard** - Copy the publisher feed XML.

## Nostr Integration

Sign in with a NIP-07 compatible browser extension (Alby, nos2x, etc.) to:
- Save feeds to Nostr relays (kind 30054)
- Load feeds from any device with your Nostr key

Default relays:
- wss://relay.damus.io
- wss://relay.primal.net
- wss://nos.lol
- wss://relay.nostr.band

## License

MIT
