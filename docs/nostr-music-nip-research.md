# Nostr Music NIP Research

**Date:** April 10, 2026
**Status:** No action required yet — monitoring

## What MSP 2.0 Currently Uses

| Kind | Purpose | Source |
|-------|---------|--------|
| 36787 | Music track publishing | Community/custom kind, not in any NIP |
| 34139 | Music playlist/album | Community/custom kind, not in any NIP |
| 30054 | RSS feed storage on relays | Community/custom kind |

## NIP-0a: Audio Tracks (PR #1043) — The Main Standardization Effort

- **PR:** https://github.com/nostr-protocol/nips/pull/1043
- **Author:** staab (Coracle)
- **Status:** OPEN (since Feb 2024, still under review as of Feb 2025)

### Proposed Kind Numbers

| Kind | Purpose |
|-------|---------|
| 31337 | Music track (reuses Zapstr's existing kind) |
| 31338 | Podcast episode |

### Proposed Tag Structure

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Random UUID identifier |
| `title` | Yes | Track title |
| `imeta` | Yes | NIP-92 media metadata (URLs, hashes) |
| `media` | Yes* | Media URL (*deprecated but required for backwards compat) |
| `subject` | Yes* | Track title (*deprecated but required for compat) |
| `c` | No | Category values — genre, artist, album, producer, composer, record label, track number, total tracks, BPM, year |
| `p` | No | Artist/contributor pubkeys (with petname/relay hints) |
| `i` | No | External GUIDs (e.g. MusicBrainz) |
| `duration` | No | Track length in seconds |
| `published_at` | No | Release timestamp |
| `website` | No | External URL |
| `zap` | No | Lightning payment recipients |

### Key Differences from MSP's Current Format

MSP currently uses dedicated tags (`artist`, `album`, `t` for genre, `track_number`, `image`, `released`, `language`). NIP-0a consolidates most of these into **`c` (category) tags** with semantic markers:

```
["c", "Rock", "genre"]
["c", "Artist Name", "artist"]
["c", "Album Title", "album"]
["c", "Producer Name", "producer"]
```

Media references use **`imeta`** (NIP-92) instead of a simple `url` tag.

## Other Efforts (Not Actively Progressing)

### Wavlake NOM Spec — Abandoned

- **Repo:** https://github.com/wavlake/nom-spec
- **Kind:** 32123
- **Status:** Draft v0.1, last commit ~3 years ago (April 2023). Effectively abandoned.
- Defined 9 fields (title, guid, creator, type, duration, published_at, link, enclosure, version)
- Wavlake has since shifted to kind 31337 (Zapstr) in practice

### M3U Playlists (Issue #1945) — Draft

- **Issue:** https://github.com/nostr-protocol/nips/issues/1945
- **Kind:** 32100
- **Status:** Draft (May 2025). Nostria client has some adoption.
- Embeds .m3u/.m3u8 playlist data in event content

### Zapstr (kind 31337) — De Facto Standard

- Zapstr.live publishes music tracks as kind 31337
- Uses `c` tags for categories
- NIP-0a is building on top of this existing usage

## Action Items

### When NIP-0a Merges

1. **Add read support for kind 31337** — so MSP can import tracks published by Wavlake/Zapstr/Coracle users
2. **Map tag formats** — convert between MSP's dedicated tags and NIP-0a's `c` category tags:
   - `artist` tag -> `["c", "value", "artist"]`
   - `album` tag -> `["c", "value", "album"]`
   - `t` (genre) tag -> `["c", "value", "genre"]`
   - `track_number` tag -> `["c", "value", "track number"]`
   - `image` tag -> `imeta` tag
   - `released` tag -> `published_at` tag
   - `url` tag -> `imeta` + `media` tags
3. **Consider dual-write** — publish as both kind 36787 and kind 31337 during a transition period
4. **Playlist interop** — evaluate whether kind 34139 should also support kind 31338 or M3U format

### No Action Needed Now

- NIP-0a hasn't merged — no finalized standard exists yet
- Kind 36787/34139 work fine for MSP's current publishing and sync workflow
- No other client has converged on a single standard either
