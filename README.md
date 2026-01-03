# MSP 2.0 - Music Side Project Studio

A web-based RSS feed editor for creating Podcasting 2.0 compatible music album feeds with Value 4 Value support.

## Features

- Create and edit podcast RSS feeds for music albums
- Podcasting 2.0 namespace support (podcast:person, podcast:value, podcast:funding, etc.)
- Value 4 Value (V4V) Lightning payment splits
- Per-track value recipient overrides
- Funding links for listener support (Patreon, Ko-fi, etc.)
- Nostr integration for cloud sync (NIP-07)
- Import/export feeds as XML
- Local storage persistence

## Tech Stack

- React 18 + TypeScript
- Vite
- Nostr (NIP-07 browser extension support)

## Project Structure

```
src/
├── components/
│   ├── Editor/
│   │   └── Editor.tsx        # Main form editor
│   ├── modals/
│   │   ├── ImportModal.tsx   # Import feed modal
│   │   └── SaveModal.tsx     # Save options modal
│   ├── InfoIcon.tsx          # Tooltip component
│   ├── NostrLoginButton.tsx  # Nostr auth button
│   ├── Section.tsx           # Collapsible section
│   └── Toggle.tsx            # Toggle switch
├── store/
│   ├── feedStore.tsx         # Album state management
│   └── nostrStore.tsx        # Nostr auth state
├── types/
│   ├── feed.ts               # Album/track types
│   └── nostr.ts              # Nostr types
├── utils/
│   ├── nostr.ts              # Nostr utilities
│   ├── nostrSync.ts          # Relay sync (kind 30054)
│   ├── xmlGenerator.ts       # RSS XML generation
│   └── xmlParser.ts          # RSS XML parsing
├── data/
│   └── fieldInfo.ts          # Form field tooltips
├── App.tsx                   # Main app component
└── App.css                   # Styles
```

## Development

```bash
npm install
npm run dev
```

## Import Options

- **Upload File** - Upload an RSS/XML feed file from your device
- **Paste XML** - Paste RSS/XML content directly
- **From URL** - Fetch a feed from any URL
- **Nostr Event** - Import from a Nostr Event (kind 36787)
- **MSP Hosted** - Load a feed hosted on MSP servers using its Feed ID
- **From Nostr** - Load your previously saved albums from Nostr (requires login)
- **From Nostr Music** - Import tracks from Nostr Music library (requires login)

## Save Options

- **Local Storage** - Save to your browser's local storage. Data persists until you clear browser data.
- **Download XML** - Download the RSS feed as an XML file to your computer.
- **Copy to Clipboard** - Copy the RSS XML to your clipboard for pasting elsewhere.
- **Host on MSP** - Host your feed on MSP servers. Get a permanent URL for your RSS feed to use in any app.
- **Save to Nostr** - Publish to Nostr relays. Load it later on any device with your Nostr key (requires login).
- **Publish Nostr Music** - Publish each track as a Nostr Music event (kind 36787) for music clients (requires login).
- **Publish to Blossom** - Upload your feed to a Blossom server. Get a stable MSP URL that always points to your latest upload (requires login).

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
