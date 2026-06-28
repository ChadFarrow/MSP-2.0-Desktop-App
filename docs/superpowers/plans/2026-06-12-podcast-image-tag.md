# Podcasting 2.0 `<podcast:image>` Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let artists add extra artwork (different aspect ratios) to album/video feeds and tracks, emitted as the modern Podcasting 2.0 `<podcast:image>` tag, with width/height/aspect-ratio/MIME auto-derived by loading the image.

**Architecture:** A new `PodcastImage` type carries an array of additional images on both `Album` and `Track` (the primary cover is unchanged and still emitted as `<itunes:image>`). The XML generator emits one `<podcast:image>` per entry at channel and item level and stops emitting the deprecated `<podcast:images>` (plural). The parser reads `<podcast:image>` back into the arrays. A new browser helper loads an image to auto-fill its dimensions/ratio/type. A reusable `PodcastImagesList` component is mounted at feed and track level.

**Tech Stack:** React 19 + TypeScript, fast-xml-parser, Vitest. Tests run in Node (no jsdom) — only pure logic is unit-tested; browser-API code (`new Image()`) and React components are verified via `npm run build` + `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-06-12-podcast-image-tag-design.md`

---

## File Structure

- `src/types/feed.ts` — **modify**: add `PodcastImage` interface, `podcastImages?` array on `Album` + `Track`, `PODCAST_IMAGE_PURPOSES` constant, factory defaults.
- `src/utils/imageMetadata.ts` — **create**: `reduceRatio`, `mimeFromUrl`, `suggestPurpose` (pure, tested) + `detectImageMetadata` (browser, untested).
- `src/utils/imageMetadata.test.ts` — **create**: unit tests for the pure helpers.
- `src/utils/xmlGenerator.ts` — **modify**: emit `<podcast:image>`; drop deprecated `<podcast:images>`.
- `src/utils/xmlParser.ts` — **modify**: parse `<podcast:image>`; add to known-keys; keep legacy parse.
- `src/components/PodcastImagesList.tsx` — **create**: reusable editor list.
- `src/components/Editor/Editor.tsx` — **modify**: mount the list at feed + track level.
- `src/types/feed.test.ts` — **create**: factory/constant sanity test.
- `src/utils/xmlGenerator.test.ts` / `src/utils/xmlParser.test.ts` — **modify**: add cases.

**Out of scope:** Publisher feeds (`PublisherFeed` type) — the approved data model only touches `Album`/`Track`. The unused `bannerArtUrl` field is left alone.

---

## Task 1: Data model — `PodcastImage` type, fields, factories, purpose presets

**Files:**
- Modify: `src/types/feed.ts`
- Test: `src/types/feed.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/types/feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createEmptyAlbum, createEmptyVideoAlbum, createEmptyTrack, PODCAST_IMAGE_PURPOSES } from './feed';

describe('podcastImages data model', () => {
  it('initializes podcastImages to an empty array on album, video album, and track', () => {
    expect(createEmptyAlbum().podcastImages).toEqual([]);
    expect(createEmptyVideoAlbum().podcastImages).toEqual([]);
    expect(createEmptyTrack(1).podcastImages).toEqual([]);
  });

  it('exposes the canvas purpose preset for Now Playing backgrounds', () => {
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('canvas');
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('artwork');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/types/feed.test.ts`
Expected: FAIL — `PODCAST_IMAGE_PURPOSES` is not exported / `podcastImages` is undefined.

- [ ] **Step 3: Add the type, constant, fields, and factory defaults**

In `src/types/feed.ts`, add the interface and constant near the other shared types (e.g. just above `createEmptyTrack` around line 240):

```ts
// Podcasting 2.0 additional images (<podcast:image>). These are EXTRA images
// (banner/canvas/social/etc.) — the primary cover stays in imageUrl/trackArtUrl.
export interface PodcastImage {
  href: string;          // required
  purpose?: string;      // space-separated tokens, e.g. "canvas" or "artwork social"
  alt?: string;
  aspectRatio?: string;  // CSS ratio syntax, e.g. "16/9", "1/1"
  width?: number;
  height?: number;
  type?: string;         // MIME, e.g. "image/jpeg"
}

// Suggested purpose tokens (open list per the spec). Single source of truth for the UI dropdown.
export const PODCAST_IMAGE_PURPOSES: { value: string; label: string; description: string }[] = [
  { value: 'artwork', label: 'Artwork', description: 'Represents the show/episode (square cover)' },
  { value: 'banner', label: 'Banner', description: 'Wide hero image to complement your artwork' },
  { value: 'canvas', label: 'Canvas', description: 'Immersive Now Playing background (desktop/mobile)' },
  { value: 'social', label: 'Social', description: 'Social preview / share card' },
  { value: 'publisher', label: 'Publisher', description: 'Publisher / label logo' },
  { value: 'circular', label: 'Circular', description: 'Image meant to be cropped to a circle' },
  { value: 'poster', label: 'Poster', description: 'Static thumbnail for video episodes' },
];
```

In `interface Track` (after `bannerArtUrl?: string;`, line 120) add:

```ts
  podcastImages?: PodcastImage[];
```

In `interface Album` (after `bannerArtUrl: string;`, line 160) add:

```ts
  podcastImages?: PodcastImage[];
```

In `interface BaseChannelData` (just before `unknownChannelElements?`, ~line 94) add the SAME field — the channel XML generator (`generateCommonChannelElements`) is typed against `BaseChannelData`, not `Album`, so the field must exist there for `data.podcastImages` to type-check. Keep it optional so `PublisherFeed` (which we are not adding the field to) still satisfies `BaseChannelData`:

```ts
  podcastImages?: PodcastImage[];
```

In `createEmptyTrack` (after `bannerArtUrl: '',`, line 256) add:

```ts
  podcastImages: [],
```

In `createEmptyAlbum` (after `bannerArtUrl: '',`, line 325) add:

```ts
  podcastImages: [],
```

In `createEmptyVideoAlbum` (after its `bannerArtUrl: '',` line) add:

```ts
  podcastImages: [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/types/feed.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types/feed.ts src/types/feed.test.ts
git commit -m "Add PodcastImage type, fields, and purpose presets"
```

---

## Task 2: `imageMetadata` helper — auto-derive dimensions, ratio, MIME, purpose

**Files:**
- Create: `src/utils/imageMetadata.ts`
- Test: `src/utils/imageMetadata.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/imageMetadata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduceRatio, mimeFromUrl, suggestPurpose } from './imageMetadata';

describe('reduceRatio', () => {
  it('reduces common HD sizes to clean ratios', () => {
    expect(reduceRatio(1920, 1080)).toBe('16/9');
    expect(reduceRatio(1500, 1000)).toBe('3/2');
    expect(reduceRatio(1000, 1000)).toBe('1/1');
  });
  it('returns empty string when a dimension is missing', () => {
    expect(reduceRatio(0, 100)).toBe('');
    expect(reduceRatio(100, 0)).toBe('');
  });
});

describe('mimeFromUrl', () => {
  it('maps extensions to MIME types, ignoring case and query strings', () => {
    expect(mimeFromUrl('https://x.com/a.JPG')).toBe('image/jpeg');
    expect(mimeFromUrl('https://x.com/a.png?v=2')).toBe('image/png');
    expect(mimeFromUrl('https://x.com/a.webp#frag')).toBe('image/webp');
    expect(mimeFromUrl('https://x.com/a.svg')).toBe('image/svg+xml');
  });
  it('returns empty string when there is no known extension', () => {
    expect(mimeFromUrl('https://x.com/noext')).toBe('');
    expect(mimeFromUrl('https://x.com/a.heic')).toBe('');
  });
});

describe('suggestPurpose', () => {
  it('suggests artwork for square-ish images', () => {
    expect(suggestPurpose('1/1')).toBe('artwork');
  });
  it('suggests banner for wide images', () => {
    expect(suggestPurpose('16/9')).toBe('banner');
    expect(suggestPurpose('4/1')).toBe('banner');
  });
  it('returns empty for tall or invalid ratios', () => {
    expect(suggestPurpose('2/3')).toBe('');
    expect(suggestPurpose('bad')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/imageMetadata.test.ts`
Expected: FAIL — module `./imageMetadata` not found.

- [ ] **Step 3: Write the helper**

Create `src/utils/imageMetadata.ts`:

```ts
// Helpers for auto-deriving <podcast:image> attributes from an image URL.

// Reduce width/height to a simplified CSS aspect-ratio string, e.g. 1920x1080 -> "16/9".
export function reduceRatio(width: number, height: number): string {
  if (!width || !height) return '';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return `${width / g}/${height / g}`;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

// Infer a MIME type from a URL's file extension. Returns '' when unknown.
export function mimeFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = clean.slice(dot + 1).toLowerCase();
  return EXT_MIME[ext] || '';
}

// Suggest a default purpose token from an aspect-ratio string like "16/9".
// Square-ish -> artwork; wider than square -> banner; otherwise '' (let the artist choose).
export function suggestPurpose(aspectRatio: string): string {
  const [w, h] = aspectRatio.split('/').map(Number);
  if (!w || !h) return '';
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'artwork';
  if (ratio > 1.1) return 'banner';
  return '';
}

export interface DetectedImageMeta {
  width?: number;
  height?: number;
  aspectRatio?: string;
  type?: string;
}

// Load an image in the browser to read its natural dimensions, then derive
// aspect-ratio and MIME. NEVER throws/rejects; resolves with whatever could be
// detected (an href alone is a valid <podcast:image>). Browser-only — not unit-tested.
export function detectImageMetadata(url: string): Promise<DetectedImageMeta> {
  return new Promise((resolve) => {
    if (!url) {
      resolve({});
      return;
    }
    const type = mimeFromUrl(url);
    const img = new Image();
    let settled = false;
    const done = (meta: DetectedImageMeta) => {
      if (settled) return;
      settled = true;
      resolve(meta);
    };
    img.onload = () => {
      const width = img.naturalWidth || undefined;
      const height = img.naturalHeight || undefined;
      const aspectRatio = width && height ? reduceRatio(width, height) : undefined;
      done({ width, height, aspectRatio, type: type || undefined });
    };
    img.onerror = () => done({ type: type || undefined });
    img.src = url;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/utils/imageMetadata.test.ts`
Expected: PASS (all `reduceRatio` / `mimeFromUrl` / `suggestPurpose` cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/imageMetadata.ts src/utils/imageMetadata.test.ts
git commit -m "Add imageMetadata helper for podcast:image auto-detection"
```

---

## Task 3: Generator — emit `<podcast:image>`, drop deprecated `<podcast:images>`

**Files:**
- Modify: `src/utils/xmlGenerator.ts` (imports line 2; channel block ~341; track block 408-417)
- Test: `src/utils/xmlGenerator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/utils/xmlGenerator.test.ts`:

```ts
import { createEmptyAlbum as makeAlbum } from '../types/feed';

describe('podcast:image generation', () => {
  it('emits a channel-level <podcast:image> for each album image, with only non-empty attrs', () => {
    const album = makeAlbum();
    album.title = 'Test';
    album.podcastImages = [
      { href: 'https://x.com/canvas.jpg', purpose: 'canvas', alt: 'wide bg', aspectRatio: '16/9', width: 1920, height: 1080, type: 'image/jpeg' },
    ];
    const xml = generateRssFeed(album);
    expect(xml).toContain('<podcast:image href="https://x.com/canvas.jpg" purpose="canvas" alt="wide bg" aspect-ratio="16/9" width="1920" height="1080" type="image/jpeg" />');
  });

  it('emits an item-level <podcast:image> for track images', () => {
    const album = makeAlbum();
    album.tracks[0].title = 'Song';
    album.tracks[0].podcastImages = [{ href: 'https://x.com/t.png', purpose: 'banner' }];
    const xml = generateRssFeed(album);
    expect(xml).toContain('<podcast:image href="https://x.com/t.png" purpose="banner" />');
  });

  it('no longer emits the deprecated <podcast:images> tag', () => {
    const album = makeAlbum();
    album.tracks[0].trackArtUrl = 'https://x.com/art.jpg';
    album.tracks[0].trackArtWidth = 3000;
    const xml = generateRssFeed(album);
    expect(xml).not.toContain('<podcast:images');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/xmlGenerator.test.ts`
Expected: FAIL — `<podcast:image>` not emitted; deprecated `<podcast:images>` still present.

- [ ] **Step 3: Add the import and emit helper**

In `src/utils/xmlGenerator.ts` line 2, add `PodcastImage` to the type import:

```ts
import type { Album, Track, Person, ValueBlock, ValueRecipient, Funding, PublisherFeed, RemoteItem, PublisherReference, BaseChannelData, PodcastImage } from '../types/feed';
```

Add a helper near the other generator helpers (e.g. just above `generateTrackXml`, ~line 390):

```ts
// Generate a single <podcast:image> element (without indentation). Returns null when href is empty.
const generatePodcastImageXml = (image: PodcastImage): string | null => {
  if (!image.href) return null;
  const attrs = [`href="${escapeXml(image.href)}"`];
  if (image.purpose) attrs.push(`purpose="${escapeXml(image.purpose)}"`);
  if (image.alt) attrs.push(`alt="${escapeXml(image.alt)}"`);
  if (image.aspectRatio) attrs.push(`aspect-ratio="${escapeXml(image.aspectRatio)}"`);
  if (image.width) attrs.push(`width="${image.width}"`);
  if (image.height) attrs.push(`height="${image.height}"`);
  if (image.type) attrs.push(`type="${escapeXml(image.type)}"`);
  return `<podcast:image ${attrs.join(' ')} />`;
};
```

- [ ] **Step 4: Emit at channel level**

In the channel generator, immediately after the iTunes image block (after line 341, the closing `}` of the `if (data.imageUrl)` itunes block), add:

```ts
  // Podcasting 2.0 additional images
  (data.podcastImages || []).forEach(img => {
    const tag = generatePodcastImageXml(img);
    if (tag) lines.push(`${indent(level)}${tag}`);
  });
```

- [ ] **Step 5: Replace the deprecated track block with the new tag**

In `generateTrackXml`, replace the existing block at lines 408-417:

```ts
  // Track artwork (falls back to album)
  const artUrl = track.trackArtUrl || album.imageUrl;
  if (artUrl) {
    lines.push(`${indent(level + 1)}<itunes:image href="${escapeXml(artUrl)}" />`);
    // Add podcast:images for better Podcast 2.0 app compatibility
    const imageAttrs = [`srcset="${escapeXml(artUrl)}"`];
    if (track.trackArtWidth) imageAttrs.push(`width="${track.trackArtWidth}"`);
    if (track.trackArtHeight) imageAttrs.push(`height="${track.trackArtHeight}"`);
    lines.push(`${indent(level + 1)}<podcast:images ${imageAttrs.join(' ')} />`);
  }
```

with:

```ts
  // Track artwork (falls back to album)
  const artUrl = track.trackArtUrl || album.imageUrl;
  if (artUrl) {
    lines.push(`${indent(level + 1)}<itunes:image href="${escapeXml(artUrl)}" />`);
  }
  // Podcasting 2.0 additional images
  (track.podcastImages || []).forEach(img => {
    const tag = generatePodcastImageXml(img);
    if (tag) lines.push(`${indent(level + 1)}${tag}`);
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- src/utils/xmlGenerator.test.ts`
Expected: PASS (all new + existing cases).

- [ ] **Step 7: Commit**

```bash
git add src/utils/xmlGenerator.ts src/utils/xmlGenerator.test.ts
git commit -m "Generate podcast:image tag, drop deprecated podcast:images"
```

---

## Task 4: Parser — read `<podcast:image>` into the arrays, keep legacy parse

**Files:**
- Modify: `src/utils/xmlParser.ts` (imports line 4; KNOWN_ITEM_KEYS line 52-67; channel parse ~144; track parse ~577)
- Test: `src/utils/xmlParser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/utils/xmlParser.test.ts`:

```ts
describe('podcast:image parsing', () => {
  const wrap = (channelExtra: string, itemExtra: string) => `<?xml version="1.0"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Test</title>
    ${channelExtra}
    <item>
      <title>Song</title>
      <guid isPermaLink="false">g1</guid>
      ${itemExtra}
    </item>
  </channel>
</rss>`;

  it('parses a channel-level podcast:image into album.podcastImages with numeric dims and aspectRatio', () => {
    const xml = wrap('<podcast:image href="https://x.com/c.jpg" purpose="canvas" alt="bg" aspect-ratio="16/9" width="1920" height="1080" type="image/jpeg" />', '');
    const album = parseRssFeed(xml);
    expect(album.podcastImages).toEqual([
      { href: 'https://x.com/c.jpg', purpose: 'canvas', alt: 'bg', aspectRatio: '16/9', width: 1920, height: 1080, type: 'image/jpeg' },
    ]);
  });

  it('parses multiple item-level podcast:image entries into track.podcastImages', () => {
    const xml = wrap('', '<podcast:image href="https://x.com/a.jpg" purpose="banner" /><podcast:image href="https://x.com/b.jpg" purpose="social" />');
    const album = parseRssFeed(xml);
    expect(album.tracks[0].podcastImages).toEqual([
      { href: 'https://x.com/a.jpg', purpose: 'banner' },
      { href: 'https://x.com/b.jpg', purpose: 'social' },
    ]);
  });

  it('still parses the legacy podcast:images tag into trackArtUrl', () => {
    const xml = wrap('', '<podcast:images srcset="https://x.com/legacy.jpg" width="3000" height="3000" />');
    const album = parseRssFeed(xml);
    expect(album.tracks[0].trackArtUrl).toBe('https://x.com/legacy.jpg');
  });

  it('round-trips podcastImages through generate -> parse', () => {
    const album = parseRssFeed(wrap('', ''));
    album.podcastImages = [{ href: 'https://x.com/c.jpg', purpose: 'canvas', aspectRatio: '16/9', width: 1920, height: 1080 }];
    album.tracks[0].podcastImages = [{ href: 'https://x.com/t.png', purpose: 'banner' }];
    const reparsed = parseRssFeed(generateRssFeed(album));
    expect(reparsed.podcastImages).toEqual(album.podcastImages);
    expect(reparsed.tracks[0].podcastImages).toEqual(album.tracks[0].podcastImages);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/xmlParser.test.ts`
Expected: FAIL — `album.podcastImages` / `track.podcastImages` undefined.

- [ ] **Step 3: Add the import and a parse helper**

In `src/utils/xmlParser.ts` line 4, add `PodcastImage` to the type import:

```ts
import type { Album, Track, Person, PersonGroup, ValueRecipient, ValueBlock, Funding, PublisherFeed, RemoteItem, PublisherReference, BaseChannelData, PodcastImage } from '../types/feed';
```

Add a helper near `getAttr` (e.g. after the `getAttr` function, ~line 227):

```ts
// Parse all <podcast:image> elements under a channel or item node into PodcastImage[].
function parsePodcastImages(parent: unknown): PodcastImage[] {
  if (!parent || typeof parent !== 'object') return [];
  const raw = (parent as Record<string, unknown>)['podcast:image'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((node): PodcastImage => {
      const image: PodcastImage = { href: getAttr(node, 'href') };
      const purpose = getAttr(node, 'purpose');
      const alt = getAttr(node, 'alt');
      const aspectRatio = getAttr(node, 'aspect-ratio');
      const width = getAttr(node, 'width');
      const height = getAttr(node, 'height');
      const type = getAttr(node, 'type');
      if (purpose) image.purpose = purpose;
      if (alt) image.alt = alt;
      if (aspectRatio) image.aspectRatio = aspectRatio;
      if (width) image.width = parseInt(width) || undefined;
      if (height) image.height = parseInt(height) || undefined;
      if (type) image.type = type;
      return image;
    })
    .filter(img => img.href);
}
```

- [ ] **Step 4: Register the known key and parse at both levels**

In `KNOWN_ITEM_KEYS` (line 52-67), add `'podcast:image'` after `'podcast:images'`:

```ts
  'podcast:images',
  'podcast:image',
```

In `parseRssFeed`, after the iTunes image fallback block (after line 144), add:

```ts
  // Podcasting 2.0 additional images
  album.podcastImages = parsePodcastImages(channel);
```

In the track-parsing function, after the legacy `podcast:images` block (after line 577), add:

```ts
  // Podcasting 2.0 additional images
  track.podcastImages = parsePodcastImages(item);
```

(Note: `captureUnknownElements` preserves any channel key NOT in `KNOWN_CHANNEL_KEYS`. If `podcast:image` is absent from that set, it gets stored in `unknownChannelElements` AND re-emitted on generate — duplicating the tag we now emit from `album.podcastImages`. So adding it to `KNOWN_CHANNEL_KEYS` is required to avoid double output.)

In `KNOWN_CHANNEL_KEYS` (ends ~line 49, after `'podcast:txt'`), add:

```ts
  'podcast:txt',  // For npub and other txt tags
  'podcast:image'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- src/utils/xmlParser.test.ts`
Expected: PASS (all new + existing cases, including round-trip).

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: PASS (no regressions across parser/generator/types).

- [ ] **Step 7: Commit**

```bash
git add src/utils/xmlParser.ts src/utils/xmlParser.test.ts
git commit -m "Parse podcast:image tag at channel and item level"
```

---

## Task 5: UI — `PodcastImagesList` component + mount in Editor

**Files:**
- Create: `src/components/PodcastImagesList.tsx`
- Modify: `src/components/Editor/Editor.tsx` (imports ~line 18; feed mount ~line 434; track mount ~line 1079)

No unit test (no jsdom/testing-library in this repo). Verified via `npm run build` + `npm run lint` + manual check.

- [ ] **Step 1: Create the component**

Create `src/components/PodcastImagesList.tsx`:

```tsx
import { useState } from 'react';
import type { PodcastImage } from '../types/feed';
import { PODCAST_IMAGE_PURPOSES } from '../types/feed';
import { detectImageMetadata, suggestPurpose } from '../utils/imageMetadata';

interface PodcastImagesListProps {
  images: PodcastImage[];
  onChange: (images: PodcastImage[]) => void;
  label?: string;
}

const CUSTOM = '__custom__';
const isPreset = (p?: string) => !!p && PODCAST_IMAGE_PURPOSES.some(opt => opt.value === p);

export function PodcastImagesList({ images, onChange, label = 'Additional Images' }: PodcastImagesListProps) {
  // Track which rows have the custom purpose input open (by index).
  const [customRows, setCustomRows] = useState<Set<number>>(new Set());

  const update = (index: number, patch: Partial<PodcastImage>) => {
    onChange(images.map((img, i) => (i === index ? { ...img, ...patch } : img)));
  };

  const add = () => onChange([...images, { href: '' }]);

  const remove = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
    setCustomRows(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  // On URL entry, auto-detect dimensions/ratio/type and suggest a purpose if none set.
  const handleUrlBlur = async (index: number, url: string) => {
    if (!url) return;
    const meta = await detectImageMetadata(url);
    const current = images[index];
    const patch: Partial<PodcastImage> = {
      width: meta.width,
      height: meta.height,
      aspectRatio: meta.aspectRatio,
      type: meta.type,
    };
    if (!current.purpose && meta.aspectRatio) {
      const suggested = suggestPurpose(meta.aspectRatio);
      if (suggested) patch.purpose = suggested;
    }
    update(index, patch);
  };

  const handlePurposeSelect = (index: number, value: string) => {
    if (value === CUSTOM) {
      setCustomRows(prev => new Set(prev).add(index));
      update(index, { purpose: '' });
    } else {
      setCustomRows(prev => { const next = new Set(prev); next.delete(index); return next; });
      update(index, { purpose: value });
    }
  };

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label">{label}</label>
      {images.map((img, index) => {
        const showCustom = customRows.has(index) || (!!img.purpose && !isPreset(img.purpose));
        const selectValue = showCustom ? CUSTOM : (img.purpose || '');
        return (
          <div key={index} className="repeatable-item">
            <div className="repeatable-item-content">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Image URL <span className="required">*</span></label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://example.com/background.jpg"
                    value={img.href}
                    onChange={e => update(index, { href: e.target.value })}
                    onBlur={e => handleUrlBlur(index, e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Purpose</label>
                  <select className="form-input" value={selectValue} onChange={e => handlePurposeSelect(index, e.target.value)}>
                    <option value="">(none)</option>
                    {PODCAST_IMAGE_PURPOSES.map(opt => (
                      <option key={opt.value} value={opt.value} title={opt.description}>{opt.label}</option>
                    ))}
                    <option value={CUSTOM}>Custom…</option>
                  </select>
                  {showCustom && (
                    <input
                      type="text"
                      className="form-input"
                      placeholder="custom purpose token(s)"
                      value={img.purpose || ''}
                      onChange={e => update(index, { purpose: e.target.value })}
                      style={{ marginTop: '0.5rem' }}
                    />
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Alt text</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Describe the image (accessibility)"
                    value={img.alt || ''}
                    onChange={e => update(index, { alt: e.target.value })}
                  />
                </div>
              </div>
              {(img.width || img.height || img.aspectRatio || img.type) && (
                <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem' }}>
                  {[img.width && img.height ? `${img.width}×${img.height}` : null, img.aspectRatio, img.type]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  <span style={{ opacity: 0.6 }}>(auto-detected)</span>
                </div>
              )}
              {img.href && (
                <img
                  src={img.href}
                  alt={img.alt || 'preview'}
                  style={{ maxHeight: '80px', marginTop: '0.5rem', borderRadius: '4px' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(index)}>Remove</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-secondary btn-sm" onClick={add}>+ Add Image</button>
    </div>
  );
}
```

- [ ] **Step 2: Mount at feed level in Editor**

In `src/components/Editor/Editor.tsx`, add the import near the `ArtworkFields` import (line 18):

```ts
import { PodcastImagesList } from '../PodcastImagesList';
```

Inside the Album/Video Artwork `<Section>` (after the `<ArtworkFields ... />` element that ends ~line 434), add:

```tsx
            <PodcastImagesList
              images={album.podcastImages || []}
              onChange={images => dispatch({ type: 'UPDATE_ALBUM', payload: { podcastImages: images } })}
            />
```

- [ ] **Step 3: Mount at track level in Editor**

After the Track Art URL input block (the `<input>` ending ~line 1079), add:

```tsx
                      <PodcastImagesList
                        label="Additional Track Images"
                        images={track.podcastImages || []}
                        onChange={images => dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { podcastImages: images } } })}
                      />
```

(Use the same loop variable the surrounding track map uses — confirm it is `index` and `track`; match the existing `dispatch({ type: 'UPDATE_TRACK', payload: { index, track: { trackArtUrl: ... } } })` call directly above.)

- [ ] **Step 4: Type-check and lint**

Run: `npm run build`
Expected: PASS — tsc compiles with no errors (verifies all types line up).

Run: `npm run lint`
Expected: PASS — no ESLint errors.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, then in the browser:
1. In Album Artwork, click **+ Add Image**, paste a wide image URL, tab out.
2. Confirm the auto-detected line shows `WxH · ratio · mime` and Purpose auto-selects **Banner**.
3. Pick **Custom…** and confirm the free-text input appears.
4. Add a track image the same way.
5. Open the Save modal → Download/Copy XML and confirm `<podcast:image .../>` appears at channel and item level, and no `<podcast:images>` (plural) is present.

- [ ] **Step 6: Commit**

```bash
git add src/components/PodcastImagesList.tsx src/components/Editor/Editor.tsx
git commit -m "Add PodcastImagesList UI at feed and track level"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test + build + lint**

Run: `npm run test && npm run build && npm run lint`
Expected: all PASS.

- [ ] **Step 2: Update CLAUDE.md XML Handling section**

Add a short note under "### XML Handling" documenting `<podcast:image>` support (array field on Album/Track, auto-detection via `imageMetadata.ts`, deprecation of generated `<podcast:images>`). Commit:

```bash
git add CLAUDE.md
git commit -m "Document podcast:image tag support in CLAUDE.md"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), parse+generate incl. deprecation (Tasks 3-4), auto-detection helper (Task 2), UI at feed+track with presets+custom+alt+auto chips (Task 5), tests (Tasks 1-4). All spec sections mapped.
- **Type consistency:** `PodcastImage` fields (`href`/`purpose`/`alt`/`aspectRatio`/`width`/`height`/`type`) are used identically in the type, generator, parser, helper, and component. `detectImageMetadata` returns `DetectedImageMeta` (no `purpose`); the component derives purpose via `suggestPurpose`. `PODCAST_IMAGE_PURPOSES` items expose `{ value, label, description }` used in the dropdown.
- **Generator/parser symmetry:** generator emits `aspect-ratio` attribute ← `aspectRatio` field; parser maps `aspect-ratio` → `aspectRatio`. Round-trip test in Task 4 guards this.
