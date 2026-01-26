# MSP 2.0 Desktop (Tauri)

This converts MSP 2.0 into a native desktop app using Tauri.

## Prerequisites

1. **Rust** - Install from https://rustup.rs
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **System dependencies** (Linux only):
   ```bash
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```

3. **Tauri CLI**:
   ```bash
   npm install -D @tauri-apps/cli
   ```

## Installation

1. Copy the `src-tauri` folder into your MSP-2.0 project root:
   ```
   MSP-2.0/
   ├── src-tauri/        <-- Add this
   │   ├── Cargo.toml
   │   ├── build.rs
   │   ├── tauri.conf.json
   │   ├── src/
   │   │   └── main.rs
   │   └── icons/
   ├── src/
   ├── package.json
   └── ...
   ```

2. Copy the new TypeScript files:
   - `src/lib/tauri-nostr.ts` - Nostr bridge for desktop
   - `src/components/DesktopNostrLogin.tsx` - Login component

3. Add Tauri dependencies to your `package.json`:
   ```bash
   npm install @tauri-apps/api @tauri-apps/plugin-dialog \
     @tauri-apps/plugin-fs @tauri-apps/plugin-shell \
     @tauri-apps/plugin-clipboard-manager
   ```

4. Add scripts to `package.json`:
   ```json
   {
     "scripts": {
       "tauri": "tauri",
       "tauri:dev": "tauri dev",
       "tauri:build": "tauri build"
     }
   }
   ```

5. Generate icons (optional but recommended):
   ```bash
   npx tauri icon ./public/your-logo.png
   ```

## Running

Development:
```bash
npm run tauri:dev
```

Build for production:
```bash
npm run tauri:build
```

Builds will be in `src-tauri/target/release/bundle/`

## Integrating Nostr Auth

Replace your existing NIP-07 login with the universal interface:

### Before (web only):
```typescript
// nostrStore.tsx
const pubkey = await window.nostr.getPublicKey();
const signed = await window.nostr.signEvent(event);
```

### After (works in both web and desktop):
```typescript
// nostrStore.tsx
import { getNostrInterface, isTauri } from '../lib/tauri-nostr';

const nostr = getNostrInterface();

// For web: uses browser extension
// For desktop: uses Tauri backend
const pubkey = await nostr.getPublicKey();
const signed = await nostr.signEvent(event);
```

### Login Component

Replace `NostrLoginButton.tsx` usage:

```tsx
import { isTauri } from '../lib/tauri-nostr';
import { DesktopNostrLogin } from './DesktopNostrLogin';
import NostrLoginButton from './NostrLoginButton'; // Your existing component

function NostrAuth() {
  if (isTauri()) {
    return <DesktopNostrLogin onLogin={handleLogin} onLogout={handleLogout} />;
  }
  return <NostrLoginButton />;
}
```

## What Changes

| Feature | Web (NIP-07) | Desktop (Tauri) |
|---------|--------------|-----------------|
| Login | Browser extension | nsec/hex input |
| Key storage | Extension handles | In-memory (secure) |
| Relay connection | Your JS code | Rust nostr-sdk |
| Signing | Extension signs | Rust signs |

## Blossom Server Integration

Blossom is a decentralized file hosting protocol that uses Nostr for authentication. Users can upload feeds, artwork, and audio files.

**Popular Blossom servers:**
- `https://blossom.primal.net`
- `https://nostr.download`
- `https://files.sovbit.host`
- `https://blossom.band`

### Usage

```typescript
import { blossomUpload, blossomUploadFile, blossomList } from './lib/blossom';

// Upload feed XML
const result = await blossomUpload(
  'https://blossom.primal.net',
  feedXml,
  'application/xml'
);
console.log('Feed URL:', result.url);
// https://blossom.primal.net/abc123...

// Upload a file from disk (audio, images, etc.)
const audioResult = await blossomUploadFile(
  'https://blossom.primal.net',
  '/path/to/track.mp3'
);

// List all your uploads on a server
const myBlobs = await blossomList('https://blossom.primal.net');
```

### BlossomManager Component

Drop-in component for uploading feeds:

```tsx
import { BlossomManager } from './components/BlossomManager';

function SaveOptions({ feedXml, feedTitle }) {
  const handleUploaded = (url: string, sha256: string) => {
    console.log('Feed hosted at:', url);
  };

  return (
    <BlossomManager
      feedXml={feedXml}
      feedTitle={feedTitle}
      onUploadComplete={handleUploaded}
    />
  );
}
```

### How Blossom Works

1. Files are addressed by their SHA256 hash
2. Authentication uses signed Nostr events (kind 24242)
3. Files are publicly accessible once uploaded
4. Only the uploader can delete their files
5. Same file uploaded twice = same URL (content-addressed)

This makes Blossom great for hosting RSS feeds - the URL changes only when the content changes, and you control your files with your Nostr key.

## Local Feed Storage

The desktop app stores feeds locally on the user's computer, separate from browser localStorage.

**Storage locations:**
- **Windows**: `C:\Users\<user>\AppData\Roaming\com.podtards.msp-studio\data\feeds`
- **macOS**: `~/Library/Application Support/com.podtards.msp-studio/feeds`
- **Linux**: `~/.local/share/msp-studio/feeds`

### Usage

```typescript
import { 
  saveFeedLocal, 
  loadFeedLocal, 
  listFeedsLocal, 
  deleteFeedLocal 
} from './lib/local-storage';

// Save a feed (returns the saved feed with ID)
const saved = await saveFeedLocal('My Album', 'album', xmlContent);
console.log('Saved with ID:', saved.id);

// Update an existing feed (pass the ID)
await saveFeedLocal('My Album (Updated)', 'album', newXml, saved.id);

// List all feeds
const feeds = await listFeedsLocal();
// Returns: [{ id, title, feed_type, created_at, updated_at }, ...]

// Load a specific feed
const feed = await loadFeedLocal(feedId);
console.log(feed.xml); // The full XML content

// Delete a feed
await deleteFeedLocal(feedId);
```

### LocalFeedsManager Component

Drop-in component to show and manage local feeds:

```tsx
import { LocalFeedsManager } from './components/LocalFeedsManager';

function App() {
  const handleLoadFeed = (xml: string, id: string, feedType: string) => {
    // Load the feed into your editor
    parseAndLoadFeed(xml);
    setCurrentFeedId(id);
  };

  return (
    <div>
      <LocalFeedsManager onLoadFeed={handleLoadFeed} />
      {/* rest of your app */}
    </div>
  );
}
```

## File System Access

The desktop app can access local files. Use the Tauri FS plugin:

```typescript
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

// Read a file
const content = await readTextFile('path/to/file.xml');

// Write a file
await writeTextFile('path/to/output.xml', xmlContent);
```

## Native Dialogs

Use native file dialogs instead of browser ones:

```typescript
import { open, save } from '@tauri-apps/plugin-dialog';

// Open file picker
const file = await open({
  filters: [{ name: 'XML', extensions: ['xml'] }]
});

// Save dialog
const path = await save({
  filters: [{ name: 'XML', extensions: ['xml'] }],
  defaultPath: 'my-feed.xml'
});
```

## Building for Different Platforms

From any platform:
```bash
npm run tauri:build
```

Cross-compilation requires additional setup. For releases, use GitHub Actions:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    strategy:
      matrix:
        platform: [macos-latest, ubuntu-22.04, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: 'MSP Studio v__VERSION__'
          releaseBody: 'See the assets for download links.'
          releaseDraft: true
```

## macOS Unsigned Apps

Since the app isn't signed with an Apple Developer certificate, macOS will show a warning. Users can open it with:

**Method 1: Right-click**
1. Right-click (or Control-click) the app
2. Select "Open" from the menu
3. Click "Open" in the dialog

**Method 2: Terminal**
```bash
xattr -cr /Applications/MSP\ Studio.app
```

**Method 3: System Settings**
1. Try to open the app normally (it will be blocked)
2. Go to System Settings > Privacy & Security
3. Scroll down to find the blocked app message
4. Click "Open Anyway"

This is totally normal for indie apps distributed outside the Mac App Store. If you later want to sign your apps ($99/year Apple Developer Program), the workflow can be extended to support it.

## Troubleshooting

**Rust compilation errors:**
```bash
cd src-tauri
cargo update
```

**WebView issues on Linux:**
Make sure webkit2gtk is installed correctly.

**"Not logged in" errors:**
The desktop app requires explicit login - there's no browser extension to auto-detect.

## Security Notes

- Private keys are stored in memory only, never written to disk
- Keys are cleared on logout or app close
- The Rust backend handles all cryptographic operations
- No external services are contacted for key management
