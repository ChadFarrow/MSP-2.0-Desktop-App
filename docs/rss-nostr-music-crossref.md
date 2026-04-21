# RSS ↔ Nostr Music Field Cross-Reference

A field-by-field mapping between the two formats MSP 2.0 emits from the same input form:

- **RSS / Podcasting 2.0** — `<channel>` + `<item>` XML with `podcast:` and `itunes:` namespaces.
- **Nostr Music** — kind `36787` (per-track event) + kind `34139` (album/playlist event).

Canonical MSP source-of-truth for these mappings:

- RSS generator — `src/utils/xmlGenerator.ts` (`generateRssFeed`, `generateTrackXml`, `generateCommonChannelElements`)
- Nostr generator — `src/utils/nostrSync.ts` (`createMusicTrackEvent` at `:514`, `createMusicPlaylistEvent` at `:583`)

## Kinds used

| Kind | Purpose | d-tag | MSP function |
|------|---------|-------|--------------|
| `36787` | One event per track | `track.guid` | `createMusicTrackEvent` |
| `34139` | One event per album/playlist, references tracks | `album.podcastGuid` | `createMusicPlaylistEvent` |
| `5` | NIP-09 deletion (unpublish) | — | `deleteNostrMusicTracks` |
| `30054` | MSP-private: full RSS XML stored as a single event for cross-device sync (not consumed by other music clients) | `podcastGuid` | `saveAlbumToNostr` |

Kind `36787` and `34139` are MSP's current choice while [NIP-0a](https://github.com/nostr-protocol/nips/pull/1043) (kind `31337`) is unmerged. See `docs/nostr-music-nip-research.md` for the standardization status.

---

## Track-level mapping (RSS `<item>` ↔ kind 36787)

| MSP field | RSS (inside `<item>`) | Nostr tag / field (kind 36787) | Notes |
|---|---|---|---|
| `track.guid` | `<guid isPermaLink="false">` | `["d", <guid>]` | Parameterized-replaceable identifier. Same string on both sides. |
| `track.title` | `<title>` | `["title", <title>]` | |
| `track.enclosureUrl` | `<enclosure url="…" type=… length=…/>` | `["url", <enclosureUrl>]` | Nostr drops `type` and `length`. If OP3 is enabled in RSS, the URL has an `https://op3.dev/e,pg={guid}/` prefix — strip it for Nostr round-trip. |
| `album.author` | `<itunes:author>` (channel) | `["artist", <author>]` | Artist lives on channel in RSS, on item in Nostr. |
| `album.title` | `<title>` (channel) | `["album", <title>]` | Same "lifted from channel" pattern. |
| `track.trackNumber` | `<podcast:episode>` (or `<itunes:episode>`) | `["track_number", <n>]` | MSP uses `<podcast:season>1</podcast:season>` + episode-as-track-number in RSS. |
| `track.duration` | `<itunes:duration>` | `["duration", <seconds>]` | RSS accepts `HH:MM:SS`; Nostr value is seconds as a string. |
| `track.explicit` | `<itunes:explicit>true/false` | `["explicit", "true"]` | Only emitted on Nostr when `true`. |
| `track.trackArtUrl` / `album.imageUrl` | `<itunes:image href>` (item; falls back to channel) + `<podcast:images srcset>` | `["image", <url>]` | Nostr uses item art if set, else album art. |
| `track.pubDate` | `<pubDate>` (RFC-822) | `["released", "YYYY-MM-DD"]` | Different date format — convert on round-trip. |
| `album.language` | `<language>` (channel) | `["language", <code>]` | Lifted from channel to item. |
| `album.categories` | `<itunes:category text=…/>` (channel) | `["t", "music"]` + `["t", <cat-lowercased>]` per category | Nostr hashtags are always lowercased. `t=music` is always added as discriminator. |
| value recipients (track override or album) | `<podcast:value>` + `<podcast:valueRecipient>` (item-level if override, else channel) | `["zap", <lnaddr-or-hex>, (<relay>,) <split>]` | Lightning address → `[zap, addr, split]`. Hex pubkey → `[zap, hex, relay, split]`. Node addresses that are neither are silently dropped. `customKey`/`customValue` are not serialized to Nostr. |
| `track.description` + `track.persons` | `<description>` + `<podcast:person group=… role=…>` (persons emitted at item level only when `track.overridePersons` is true; otherwise persons live on `<channel>`) | `content` field (plain text) | Description goes first, then a `Credits:` section with `Name: role1, role2` per line. Persons' `href` and `img` are not serialized to Nostr. |
| — | — | `["client", "MSP 2.0"]` | Added by MSP; useful for consumers to filter/attribute. |
| — | — | `["alt", "Music track: …"]` | NIP-31 fallback text for non-music clients. |
| `track.transcriptUrl` / `transcriptType` | `<podcast:transcript url=… type=…/>` | *(not serialized)* | RSS-only. |
| unknown item elements | preserved round-trip in RSS | *(not serialized)* | `track.unknownItemElements` only survives the RSS path. |

### Example: one track on each side

RSS:
```xml
<item>
  <title>Hello World</title>
  <description>Opening track.</description>
  <pubDate>Mon, 20 Apr 2026 12:00:00 +0000</pubDate>
  <guid isPermaLink="false">c3f2b9d4-…</guid>
  <itunes:image href="https://cdn.example.com/art.jpg"/>
  <enclosure url="https://cdn.example.com/track1.mp3" length="5242880" type="audio/mpeg"/>
  <itunes:duration>213</itunes:duration>
  <podcast:season>1</podcast:season>
  <podcast:episode>1</podcast:episode>
  <itunes:explicit>false</itunes:explicit>
  <podcast:value type="lightning" method="keysend">
    <podcast:valueRecipient name="Artist" address="artist@getalby.com" split="95" type="lnaddress"/>
  </podcast:value>
</item>
```

Nostr kind 36787:
```json
{
  "kind": 36787,
  "tags": [
    ["d", "c3f2b9d4-…"],
    ["title", "Hello World"],
    ["url", "https://cdn.example.com/track1.mp3"],
    ["artist", "The Band"],
    ["album", "First LP"],
    ["track_number", "1"],
    ["client", "MSP 2.0"],
    ["alt", "Music track: Hello World by The Band"],
    ["duration", "213"],
    ["image", "https://cdn.example.com/art.jpg"],
    ["released", "2026-04-20"],
    ["language", "en"],
    ["t", "music"],
    ["t", "rock"],
    ["zap", "artist@getalby.com", "95"]
  ],
  "content": "Opening track."
}
```

---

## Album-level mapping (RSS `<channel>` ↔ kind 34139)

| MSP field | RSS (inside `<channel>`) | Nostr tag / field (kind 34139) | Notes |
|---|---|---|---|
| `album.podcastGuid` | `<podcast:guid>` | `["d", <podcastGuid>]` | Same UUID on both sides. |
| `album.title` | `<title>` | `["title", <title>]` | |
| `album.description` | `<description>` | `["description", <text>]` + also duplicated into `content` | RSS has only one description slot. |
| `album.imageUrl` | `<image><url>` + `<itunes:image href>` | `["image", <url>]` | |
| `album.categories` | `<itunes:category text=…/>` (repeatable) | `["t", <cat-lowercased>]` per category | Same lowercase rule as tracks. `t=music` is **not** auto-added at playlist level (it is on tracks). |
| track list | `<item>` children (ordered) | `["a", "36787:<pubkey>:<track-d-tag>"]` per track (ordered) | On Nostr, tracks are referenced by kind:pubkey:d-tag triples. The d-tag is the RSS `<guid>`. `<pubkey>` is the Nostr signer's hex pubkey (the playlist event's own `pubkey` — i.e. whoever published), **not** `album.artistNpub`. |
| `album.value.recipients` | `<podcast:value>` + `<podcast:valueRecipient>` | `["zap", …]` tags (same shape as tracks) | Channel-level recipients. |
| — | — | `["client", "MSP 2.0"]` | |
| — | — | `["alt", "Playlist: … by …"]` | |
| — | — | `["public", "true"]` | MSP always marks playlists public. |
| `album.author` | `<itunes:author>` | *(not serialized on playlist)* | Artist is only on individual track events. |
| `album.language` | `<language>` | *(not serialized on playlist)* | Lives on per-track events only. |
| `album.persons` | `<podcast:person …>` (channel) | *(not serialized on playlist)* | Channel-level persons are dropped; track-level persons flow into track `content`. |
| `album.funding` | `<podcast:funding url=…>` | *(not serialized)* | |
| `album.locked` / `lockedOwner` | `<podcast:locked owner=…>yes</podcast:locked>` | *(not serialized)* | |
| `album.medium` | `<podcast:medium>music`/`video`/`publisher`</podcast:medium>` | *(not serialized; kind 36787 implies music)* | Videos and publisher feeds have no Nostr-music equivalent. |
| `album.ownerName`/`ownerEmail`, `managingEditor`, `webMaster`, `keywords`, `generator`, `lastBuildDate`, `pubDate` | standard RSS/iTunes elements | *(not serialized)* | RSS-only metadata. Nostr's `created_at` is the closest analog to `lastBuildDate`. |
| `album.artistNpub` | `<podcast:txt purpose="npub">` | *(redundant; `pubkey` on the event is the signer)* | |
| `album.publisher` | `<podcast:publisher><podcast:remoteItem .../></podcast:publisher>` | *(not serialized)* | Publisher graphs are RSS-only. |
| `album.op3` | OP3 prefix applied to `<enclosure url>` | *(not serialized; strip before emitting Nostr)* | Analytics is an RSS-delivery concern. |
| unknown channel elements | preserved round-trip in RSS | *(not serialized)* | |

### Example: playlist event

```json
{
  "kind": 34139,
  "tags": [
    ["d", "a7e8f2c1-…"],
    ["title", "First LP"],
    ["alt", "Playlist: First LP by The Band"],
    ["client", "MSP 2.0"],
    ["description", "Our debut album."],
    ["image", "https://cdn.example.com/art.jpg"],
    ["a", "36787:<pubkey>:c3f2b9d4-…"],
    ["a", "36787:<pubkey>:d4f3a2e5-…"],
    ["t", "rock"],
    ["zap", "artist@getalby.com", "95"],
    ["public", "true"]
  ],
  "content": "Our debut album."
}
```

---

## Converter checklist

**RSS → Nostr Music**

1. For each `<item>`: build a kind 36787 event using the table above. Copy `album.title` and `<itunes:author>` down into every track's `album` / `artist` tags.
2. Lowercase `<itunes:category>` values for `t` tags; prepend `["t","music"]`.
3. Convert `<pubDate>` (RFC-822) → `released` (`YYYY-MM-DD`).
4. Convert `<itunes:duration>` to integer seconds.
5. Strip any `https://op3.dev/e…/` prefix from enclosure URLs.
6. Filter `<podcast:valueRecipient>` to only `lnaddress` or 64-hex-char `node` addresses; pick `[zap, addr, split]` vs `[zap, hex, relay, split]` based on format.
7. Flatten `<podcast:person>` into a `Credits:` block in the event `content`.
8. If 2+ tracks, build one kind 34139 event with `["a","36787:<pubkey>:<guid>"]` references in track order; d-tag = `<podcast:guid>`.

**Nostr Music → RSS**

1. Group kind 36787 events by their `album` tag (or by a shared kind 34139 playlist). Use the playlist's `d` tag as `<podcast:guid>`.
2. Channel: `album` → `<title>`, `artist` → `<itunes:author>`, `language` → `<language>`, `image` → `<itunes:image>`, playlist `description` → `<description>`, each `t` (except `music`) → `<itunes:category>`.
3. Item per track: `title` → `<title>`, `url` → `<enclosure url>` (Nostr carries no MIME type or byte length — supply `type="audio/mpeg"` as a sensible default and either HEAD-request the URL for `length` or omit/zero it; note MSP's generator does not substitute a default for missing `enclosureType`, so be explicit), `duration` → `<itunes:duration>`, `released` (YYYY-MM-DD) → `<pubDate>` (RFC-822, midnight UTC), `d` → `<guid isPermaLink="false">`, `image` → `<itunes:image href>`, `explicit=true` → `<itunes:explicit>true`.
4. Map `zap` tags back to `<podcast:valueRecipient>`. You won't recover `customKey`/`customValue`.
5. Split the first paragraph of `content` before `Credits:` back into `<description>`; parse the `Credits:` lines into `<podcast:person>` entries (group/role/href/img not recoverable without extra conventions).
6. Fill `<podcast:medium>music</podcast:medium>` and set `<podcast:season>1</podcast:season>` + `<podcast:episode>{track_number}</podcast:episode>`.

## Data loss, by direction

**Lost going RSS → Nostr:** transcripts, funding, locked, publisher links, medium, owner contact info, keywords, managingEditor/webMaster, person `href`/`img`, value recipient `customKey`/`customValue`, enclosure `type` and `length`, OP3 routing, season, `<podcast:images>` `srcset`, any unknown-namespace elements.

**Lost going Nostr → RSS:** `client`, `alt`, `public`, NIP-09 deletion semantics (RSS has no "retract this item"), the cryptographic signature itself.

**Preserved on both sides:** track `guid` / `d`, album `podcastGuid` / playlist `d`, title, enclosure/url, artist, album, track number, duration, explicit flag, release date, image, language, categories (as lowercased hashtags), Lightning zap splits (for lnaddress/hex-pubkey recipients).

---

## Quick visual

```
┌────────────────────── User fills MSP form ──────────────────────┐
│                                                                 │
│  Album { title, author, description, podcastGuid, categories,   │
│          value, image, language, tracks: [ Track { ... } ] }    │
│                                                                 │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
        xmlGenerator.ts                 nostrSync.ts
                │                             │
                ▼                             ▼
        ┌───────────────┐            ┌─────────────────┐
        │  RSS <channel>│            │  kind 34139     │
        │    + <item>s  │            │    + kind 36787 │
        │               │            │      per track  │
        │  Podcasting   │            │  MSP-custom,    │
        │  2.0 namesp.  │            │  pre-NIP-0a     │
        └───────────────┘            └─────────────────┘
```
