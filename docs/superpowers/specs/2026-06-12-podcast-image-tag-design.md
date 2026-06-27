# Design: Podcasting 2.0 `<podcast:image>` tag support

**Date:** 2026-06-12
**Branch:** `add-podcast-image-tag`
**Status:** Approved

## Goal

Make it simple for an artist to add **extra artwork they already have** (different
aspect ratios — e.g. a wide background image for desktop/mobile Now Playing screens,
a banner, a social card) to their MSP feeds. The app emits the modern Podcasting 2.0
`<podcast:image>` tag with whatever the spec needs, **auto-deriving** most attributes
by loading the image so the artist only pastes a URL and (optionally) tweaks the
purpose and adds alt text.

This adds support for the singular `<podcast:image>` tag
(https://podcasting2.org/docs/podcast-namespace/tags/image), which supersedes the
deprecated `<podcast:images>` (plural, srcset) tag.

### Spec recap

`<podcast:image>` attributes:

| Attribute | Required | Notes |
|---|---|---|
| `href` | **Yes** | URL of the asset |
| `alt` | recommended | accessibility text |
| `aspect-ratio` | recommended | CSS ratio syntax, e.g. `16/9`, `1/1` |
| `width` | recommended | pixels |
| `height` | no | pixels |
| `type` | no | MIME, e.g. `image/jpeg` |
| `purpose` | no | space-separated tokens (max 128 chars), open/extensible |

- May appear at `<channel>`, `<item>`, and `<podcast:liveItem>` level, **multiple times**.
- Cross-compatible with `<itunes:image>`.
- Recommended `purpose` tokens (open list): `artwork`, `social`, `canvas`
  (immersive Now Playing — the desktop/mobile background use case), `banner` (hero),
  `publisher`, `circular`, `poster` (video thumbnail).

## Scope

- **Feed level + track level.** Both the whole album/video feed and individual tracks
  can carry additional images. (Publisher feeds are out of scope — the data model only
  touches `Album`/`Track`; see "Out of scope" below. liveItem is not part of MSP's
  model; out of scope.)
- These arrays hold **additional** images only. The primary cover (`imageUrl` /
  `trackArtUrl`) is unchanged and still emitted as `<itunes:image>` + `<image>`.
- **Out of scope:** the unused `bannerArtUrl` field is left alone; we do not
  auto-mirror the primary cover as a `purpose="artwork"` `<podcast:image>` (apps
  already get it via `<itunes:image>`).

## 1. Data model (`src/types/feed.ts`)

```ts
export interface PodcastImage {
  href: string;          // required
  purpose?: string;      // space-separated tokens, e.g. "canvas" or "artwork social"
  alt?: string;
  aspectRatio?: string;  // e.g. "16/9", "1/1"
  width?: number;
  height?: number;
  type?: string;         // MIME, e.g. "image/jpeg"
}
```

- Add `podcastImages?: PodcastImage[]` to both `Album` and `Track`.
- `createEmptyAlbum` / `createEmptyTrack` initialize to `[]`.
- Add a `PODCAST_IMAGE_PURPOSES` constant: the preset dropdown options
  (`artwork`, `banner`, `canvas`, `social`, `publisher`, `circular`, `poster`),
  each with a short human description. Single source of truth, imported by the UI.
  This is the canonical definition in `types/feed.ts` (same pattern as the
  community-support recipient constants).

## 2. Parse + Generate

### Generate (`src/utils/xmlGenerator.ts`)

- For each `PodcastImage` in `album.podcastImages`, emit a channel-level
  `<podcast:image .../>`. For each in `track.podcastImages`, emit an item-level
  `<podcast:image .../>`.
- Emit only non-empty attributes, in spec order: `href`, `purpose`, `alt`,
  `aspect-ratio`, `width`, `height`, `type`. All values XML-escaped.
- **Deprecation:** stop emitting the current deprecated track-level
  `<podcast:images>` (plural, srcset, width, height) block.

### Parse (`src/utils/xmlParser.ts`)

- Read all `<podcast:image>` elements at channel level → `album.podcastImages`, and at
  item level → `track.podcastImages`. fast-xml-parser returns a single object or an
  array depending on count — normalize to an array. Map `aspect-ratio` → `aspectRatio`,
  `width`/`height` → numbers.
- Keep parsing the legacy `<podcast:images>` (plural) for backward compatibility
  (existing behavior: first srcset URL → `trackArtUrl`, width/height → track fields).
- Add `'podcast:image'` to the known-keys sets (channel + item) so the elements are not
  captured as "unknown" passthrough.

### Round-trip

A feed MSP generates has `<itunes:image>` (primary) + N `<podcast:image>` (extras).
Reimporting yields the same primary + same extras array. Tested explicitly.

## 3. UI

### New reusable component: `PodcastImagesList`

Modeled on `RecipientsList`. Used in two places:

- **Feed level** — inside the Album/Video Artwork section in `Editor.tsx`, below
  `ArtworkFields`.
- **Track level** — in the per-track editor near the Track Art URL field, collapsed
  by default to avoid clutter.

Each row is mostly automatic:

- **URL field** (paste). On paste/blur, calls `detectImageMetadata(url)` and
  auto-fills the derived fields + suggests a purpose.
- **Purpose** — dropdown of `PODCAST_IMAGE_PURPOSES` presets + a "Custom…" option that
  reveals a free-text input. Pre-selected from the detected aspect ratio (see helper),
  editable.
- **Alt text** — free text (accessibility; cannot be derived).
- **Auto-detected chips** — small read-only display like `1920×1080 · 16/9 · image/jpeg`
  with a tiny "edit" toggle as an escape hatch when detection is wrong or the image
  won't load (CORS/404). Detection failure is **non-blocking** — `href` alone is a
  valid `<podcast:image>`.
- Thumbnail preview, Add / Remove buttons.

### State management

State updates dispatch the whole updated array via the existing `UPDATE_ALBUM` /
`UPDATE_TRACK` actions (their payloads already accept partial fields). No new reducer
actions are needed — `<podcast:image>` entries have no special business logic like the
value-recipient support splits.

## 4. New helper: `src/utils/imageMetadata.ts`

`detectImageMetadata(url): Promise<{ width?, height?, aspectRatio?, type? }>`:

- Loads `new Image()`, reads `naturalWidth` / `naturalHeight` on `load` (image
  dimensions do not require CORS).
- Reduces `width`/`height` to a simplified ratio via GCD for `aspectRatio`
  (e.g. 1920×1080 → `16/9`, 1500×1000 → `3/2`).
- Maps the URL's file extension → MIME for `type` (`.jpg`/`.jpeg`→`image/jpeg`,
  `.png`→`image/png`, `.webp`→`image/webp`, `.gif`→`image/gif`, `.avif`→`image/avif`,
  `.svg`→`image/svg+xml`).
- Resolves with whatever could be detected; **never throws** (failure leaves fields
  empty so the artist can still save with just an href).

A small pure helper `suggestPurpose(aspectRatio)` maps a ratio to a default purpose
(≈square → `artwork`; wide, ratio ≥ ~2/1 → `banner`/`canvas`; otherwise empty). Exposed
for the UI's purpose pre-selection and unit-tested independently of image loading.

## 5. Testing

- `xmlGenerator.test.ts`: emits one `<podcast:image>` per entry with correct attrs and
  spec ordering; omits empty attrs; no longer emits the deprecated `<podcast:images>`.
- `xmlParser.test.ts`: parses single + multiple `<podcast:image>` at channel and item
  level; `aspect-ratio`→`aspectRatio` and numeric coercion; legacy `<podcast:images>`
  still parsed; round-trip (generate → parse) preserves the array.
- `imageMetadata.test.ts`: GCD ratio reduction, extension→MIME mapping, and
  `suggestPurpose` thresholds (pure logic; image loading mocked or factored out).

## Files touched

- `src/types/feed.ts` — `PodcastImage` type, array fields, factories, `PODCAST_IMAGE_PURPOSES`.
- `src/utils/xmlGenerator.ts` — emit `<podcast:image>`; drop deprecated `<podcast:images>`.
- `src/utils/xmlParser.ts` — parse `<podcast:image>`; known-keys; keep legacy parse.
- `src/utils/imageMetadata.ts` — **new** detection + `suggestPurpose` helper.
- `src/components/PodcastImagesList.tsx` — **new** reusable UI list.
- `src/components/Editor/Editor.tsx` — mount the list at feed + track level.
- Tests: `xmlGenerator.test.ts`, `xmlParser.test.ts`, `imageMetadata.test.ts` (new).
