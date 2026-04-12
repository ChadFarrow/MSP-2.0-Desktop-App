# MSP 2.0 - Music Side Project Studio

A web-based RSS feed editor for creating Podcasting 2.0 compatible music album feeds, video feeds, and publisher catalogs with Value 4 Value support.

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

### Video Mode
- Create RSS feeds for video content (podcast:medium = video)
- Same feature set as Album mode with video-specific defaults
- Video enclosure type support (video/mp4, etc.)

### Publisher Mode
- Create publisher/label catalog feeds
- Manage multiple album feeds under one publisher identity
- Podcast Index integration (search and add feeds by name or GUID)
- Bulk download catalog feeds with publisher references
- Host publisher feeds on MSP with automatic Podcast Index notification
- Nostr identity linking for token-free editing

### Integrations
- Nostr cloud sync (NIP-07 browser extension + NIP-46 remote signer)
- Nostr Music publishing (kind 36787 track events + kind 34139 playlist) with NIP-09 unpublish
- NIP-71 `naddr` video resolution (paste an `naddr` into a Video URL field to auto-fill)
- Podcast Index search, feed submission, and pubnotify
- MSP feed hosting with edit tokens and Nostr-linked ownership
- Blossom server uploads (BUD-01) for file hosting
- nsite (NIP-5A) publishing — decentralized feed hosting via Blossom + site manifest
- OP3 analytics prefix support for privacy-respecting download stats
- Dark/light theme support

## Tech Stack

- React 19 + TypeScript 5.9
- Vite 7
- Vercel (hosting + serverless API + Blob storage)
- Nostr (NIP-07, NIP-46, NIP-98)

## Project Structure

```
src/
├── components/
│   ├── Editor/
│   │   ├── Editor.tsx              # Album/video editor
│   │   └── PublisherEditor/        # Publisher mode components
│   │       ├── index.tsx
│   │       ├── PublisherInfoSection.tsx
│   │       ├── PublisherArtworkSection.tsx
│   │       ├── CatalogFeedsSection.tsx
│   │       ├── PublisherValueSection.tsx
│   │       ├── PublisherFundingSection.tsx
│   │       ├── DownloadCatalogSection.tsx
│   │       ├── PublishSection.tsx
│   │       └── PublisherFeedReminderSection.tsx
│   ├── modals/
│   │   ├── ImportModal.tsx         # Import feed modal
│   │   ├── SaveModal.tsx           # Save options modal
│   │   ├── PreviewModal.tsx        # Feed preview modal
│   │   ├── InfoModal.tsx           # Info/about modal
│   │   ├── NostrConnectModal.tsx   # NIP-46 remote signer
│   │   ├── NewFeedChoiceModal.tsx  # Start blank vs. use template
│   │   ├── PodcastIndexModal.tsx   # Manual Podcast Index submission
│   │   ├── ConfirmModal.tsx        # Confirmation dialog
│   │   └── ModalWrapper.tsx        # Shared modal layout
│   ├── admin/
│   │   ├── AdminPage.tsx           # Admin panel
│   │   ├── FeedList.tsx            # Feed management list
│   │   └── DeleteConfirmModal.tsx  # Feed deletion confirm
│   ├── AddRecipientSelect.tsx      # Recipient auto-complete
│   ├── ArtworkFields.tsx           # Artwork fields
│   ├── FundingFields.tsx           # Funding link fields
│   ├── InfoIcon.tsx                # Tooltip component
│   ├── NostrLoginButton.tsx        # Nostr auth button
│   ├── RecipientsList.tsx          # Value recipients with community support
│   ├── Section.tsx                 # Collapsible section
│   └── Toggle.tsx                  # Toggle switch
├── store/
│   ├── feedStore.tsx               # Album, video & publisher state
│   ├── nostrStore.tsx              # Nostr auth state
│   └── themeStore.tsx              # Dark/light theme state
├── types/
│   ├── feed.ts                     # Album/track/publisher types
│   └── nostr.ts                    # Nostr types
├── utils/
│   ├── addressUtils.ts             # Lightning address detection
│   ├── adminAuth.ts                # Admin auth (client-side)
│   ├── audioUtils.ts               # Audio duration/metadata
│   ├── blossom.ts                  # Blossom server uploads
│   ├── comparison.ts               # Value block comparison
│   ├── dateUtils.ts                # RFC-822 date formatting
│   ├── hostedFeed.ts               # MSP hosted feed management
│   ├── nostr.ts                    # Nostr key utilities
│   ├── nostrMusicConverter.ts      # Album ↔ Nostr Music conversion
│   ├── nostrRelay.ts               # Relay connection management
│   ├── nostrSigner.ts              # NIP-46 remote signer
│   ├── nostrSync.ts                # Relay sync (kind 30054)
│   ├── publisherPublish.ts         # Publisher feed hosting
│   ├── storage.ts                  # localStorage utilities
│   ├── videoUtils.ts               # Video feed utilities
│   ├── xmlGenerator.ts             # RSS XML generation
│   └── xmlParser.ts                # RSS XML parsing
├── data/
│   └── fieldInfo.ts                # Form field tooltips
├── App.tsx                         # Main app with mode switching
└── App.css                         # Styles

api/
├── _utils/
│   ├── adminAuth.ts                # Nostr NIP-98 auth verification
│   ├── feedUtils.ts                # Shared feed utilities
│   └── podcastIndex.ts             # Podcast Index auth headers
├── admin/
│   ├── challenge.ts                # Auth challenge generation
│   └── verify.ts                   # Auth verification
├── feed/
│   └── [npub]/[guid].ts            # Nostr-stored feed retrieval
├── hosted/
│   ├── index.ts                    # Create/list hosted feeds
│   └── [feedId].ts                 # Get/update/delete hosted feeds
├── pisearch.ts                     # Podcast Index search
├── pisubmit.ts                     # Podcast Index feed submission
├── proxy-feed.ts                   # Feed proxy for CORS
└── pubnotify.ts                    # Podcast Index pub notification
```

## Development

```bash
npm install
npm run dev
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

## Import Options (Album/Video Mode)

- **Upload File** - Upload an RSS/XML feed file from your device
- **Paste XML** - Paste RSS/XML content directly
- **From URL** - Fetch a feed from any URL
- **Nostr Event** - Import from a Nostr Music event (kind 36787)
- **MSP Hosted** - Load a feed hosted on MSP servers using its Feed ID
- **From Nostr** - Load your previously saved feeds from Nostr (kind 30054, requires login)
- **From Nostr Music** - Import tracks from Nostr Music library (requires login)
- **naddr paste (Video mode)** - Paste a NIP-71 `naddr` (or a URL containing one) into a Video URL field to auto-resolve URL, MIME type, and duration

## Save Options (Album/Video Mode)

- **Local Storage** - Save to your browser's local storage. Data persists until you clear browser data.
- **Download XML** - Download the RSS feed as an XML file to your computer.
- **Copy to Clipboard** - Copy the RSS XML to your clipboard for pasting elsewhere.
- **Host on MSP** - Host your feed on MSP servers. Get a permanent subscribable URL (`https://msp.podtards.com/api/hosted/{feedId}`) to use in any podcast app.
- **Save RSS feed to Nostr** - Embed the full RSS XML in a kind 30054 event for personal cross-device sync. Only MSP reads this event — not subscribable in podcast apps (requires login).
- **Publish to Nostr Music** - Publish each track as a kind 36787 event plus a kind 34139 playlist event for Nostr-native music clients (Wavlake, Fountain, etc.). Includes an Unpublish button that sends a NIP-09 deletion request (requires login).
- **Publish RSS feed to a Blossom server** - Upload your feed to a Blossom server with a kind 1063 (NIP-94) pointer event so `${origin}/api/feed/{npub}/{podcastGuid}.xml` always resolves to the latest upload. Subscribable in podcast apps (requires login).
- **Publish RSS feed to nsite (experimental)** - Publish via Blossom + a NIP-5A site manifest (kind 35128). Subscribable via any nsite gateway URL, and auto-submitted to Podcast Index (requires login).

## Save Options (Publisher Mode)

- **Local Storage** - Save publisher feed to browser storage.
- **Download XML** - Download the publisher catalog feed as XML.
- **Copy to Clipboard** - Copy the publisher feed XML.

## Nostr Integration

Sign in with a NIP-07 compatible browser extension (Alby, nos2x, etc.) or connect a NIP-46 remote signer (Amber, nsecBunker) to:
- Save RSS feeds to Nostr relays (kind 30054, for cross-device sync)
- Load feeds from any device with your Nostr key
- Publish Nostr Music (kind 36787 track events + kind 34139 playlist), with NIP-09 unpublish
- Publish to Blossom servers (BUD-01 auth, NIP-94 pointer events)
- Publish to nsite (NIP-5A site manifests, kind 35128)
- Link your identity to MSP-hosted feeds for token-free editing

Default relays:
- wss://relay.damus.io
- wss://relay.primal.net
- wss://nos.lol
- wss://relay.nostr.band

## License

MIT
