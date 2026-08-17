# RSS ↔ Nostr Music Field Cross-Reference

A field-by-field mapping between the two formats MSP 2.0 emits from the same input form:

- **RSS / Podcasting 2.0** — `<channel>` + `<item>` XML with `podcast:` and `itunes:` namespaces.
- **Nostr Music** — kind `36787` (per-track event) + kind `34139` (album/playlist event).

Canonical MSP source-of-truth for these mappings:

- RSS generator — `src/utils/xmlGenerator.ts` (`generateRssFeed`, `generateTrackXml`, `generateCommonChannelElements`)
- Nostr generator — `src/utils/nostrSync.ts` (`createMusicTrackEvent`, `createMusicPlaylistEvent`)
- Nostr reader — `src/utils/nostrMusicConverter.ts` (`parseNostrMusicEvent`, `buildValueBlockFromZaps`)

Function names rather than line numbers: pinned line numbers here drifted silently once already.

## Kinds used

| Kind | Purpose | d-tag | MSP function |
|------|---------|-------|--------------|
| `36787` | One event per track | `track.guid` | `createMusicTrackEvent` |
| `34139` | One event per album/playlist, references tracks | `album.podcastGuid` | `createMusicPlaylistEvent` |
| `5` | NIP-09 deletion (unpublish) | — | `deleteNostrMusicTracks` |
| `30054` | MSP-private: full RSS XML stored as a single event for cross-device sync (not consumed by other music clients) | `podcastGuid` | `saveAlbumToNostr` |

Kind `36787` and `34139` are MSP's current choice while [NIP-0a](https://github.com/nostr-protocol/nips/pull/1043) (kind `31337`) is unmerged. See `docs/nostr-music-nip-research.md` for the standardization status.

### Relays

Music events do not go to the same relays as everything else. `src/utils/nostrRelay.ts` defines:

- `DEFAULT_RELAYS` — `relay.damus.io`, `relay.primal.net`, `nos.lol`
- `MUSIC_RELAYS` — `DEFAULT_RELAYS` + `wss://drops.basspistol.org`

`publishNostrMusicTracks`, `fetchNostrMusicTracks` and `deleteNostrMusicTracks` all default to
`MUSIC_RELAYS`, because basspistol only accepts music kinds and would reject kind 0/30054/1063
traffic. The relay *hint* embedded in a hex-pubkey zap tag is `DEFAULT_RELAYS[0]`.

---

## Track-level mapping (RSS `<item>` ↔ kind 36787)

| MSP field | RSS (inside `<item>`) | Nostr tag / field (kind 36787) | Notes |
|---|---|---|---|
| `track.guid` | `<guid isPermaLink="false">` | `["d", <guid>]` | Parameterized-replaceable identifier. Same string on both sides. |
| `track.title` | `<title>` | `["title", <title>]` | |
| `track.enclosureUrl` | `<enclosure url="…" type=… length=…/>` | `["url", <enclosureUrl>]` | Nostr drops `type` and `length`. The OP3 prefix is applied at *generation* time and stripped at *parse* time, so `track.enclosureUrl` in MSP's state is always bare and needs no stripping here — a third-party implementer reading finished RSS does have to strip `https://op3.dev/e,pg={guid}/` themselves. |
| `album.author` | `<itunes:author>` (channel) | `["artist", <author>]` | Artist lives on channel in RSS, on item in Nostr. |
| `album.title` | `<title>` (channel) | `["album", <title>]` | Same "lifted from channel" pattern. |
| `track.trackNumber` | `<podcast:episode>` | `["track_number", <n>]` | MSP emits `<podcast:season>1</podcast:season>` + `<podcast:episode>`, never `<itunes:episode>`. The episode value is `track.episode` when set, falling back to `track.trackNumber`. |
| `track.duration` | `<itunes:duration>` | `["duration", <seconds>]` | RSS accepts `HH:MM:SS`; Nostr value is seconds as a string. |
| `track.explicit` | `<itunes:explicit>true/false` | `["explicit", "true"]` | Only emitted on Nostr when `true`. |
| `track.trackArtUrl` / `album.imageUrl` | `<itunes:image href>` (item; falls back to channel) | `["image", <url>]` | Nostr uses item art if set, else album art. The deprecated plural `<podcast:images srcset>` is no longer generated — `xmlParser.ts` still *reads* it for back-compat with older feeds. |
| `track.podcastImages` / `album.podcastImages` | `<podcast:image href=… purpose=… alt=… aspect-ratio=… width=… height=… type=…/>` (channel and item) | *(not serialized)* | Additional artwork — banner, canvas, social card. RSS-only; see `PODCAST_IMAGE_PURPOSES` in `src/types/feed.ts`. |
| `track.pubDate` | `<pubDate>` (RFC-822) | `["released", "MM/DD/YYYY"]` | Different date format — convert on round-trip. **`MM/DD`, not `DD/MM`**, and both ends read/write in **UTC** (`formatReleasedDate` / `parseReleasedDate` in `src/utils/dateUtils.ts`). The reader falls back to `DD/MM` only when the first component is >12, which is unambiguous. Getting this pair out of step is what made a publish→import round-trip swap month and day. |
| `album.language` | `<language>` (channel) | `["language", <code>]` | Lifted from channel to item. |
| `album.categories` | `<itunes:category text=…/>` (channel) | `["t", "music"]` + `["t", <cat-lowercased>]` per category | Nostr hashtags are always lowercased. `t=music` is always added as discriminator. |
| value recipients (track override or album) | `<podcast:value>` + `<podcast:valueRecipient>` (item-level if override, else channel) | `["zap", <lnaddr-or-hex>, (<relay>,) <split>]` | Lightning address → `[zap, addr, split]` (**3 elements, split at index 2**). Hex pubkey → `[zap, hex, relay, split]` (4 elements; the relay hint is `DEFAULT_RELAYS[0]`). Node addresses that are neither are silently dropped. `customKey`/`customValue` are not written. ⚠️ See the note below the table — MSP's own reader does not handle the 3-element form. |
| `track.description` + `track.persons` | `<description>` + `<podcast:person group=… role=…>` (persons emitted at item level only when `track.overridePersons` is true; otherwise persons live on `<channel>`) | `content` field (plain text) | Description goes first, then a `Credits:` section with `Name: role1, role2` per line. Persons' `href` and `img` are not serialized to Nostr. |
| — | — | `["client", "MSP 2.0"]` | Added by MSP; useful for consumers to filter/attribute. |
| — | — | `["alt", "Music track: …"]` | NIP-31 fallback text for non-music clients. |
| `track.transcriptUrl` / `transcriptType` | `<podcast:transcript url=… type=…/>` | *(not serialized)* | RSS-only. MSP's writer never emits a `Lyrics:` or `License:` section, but `parseNostrMusicContent` *reads* both so that events from other clients aren't lost — their text is folded into `track.description`. |
| unknown item elements | preserved round-trip in RSS | *(not serialized)* | `track.unknownItemElements` only survives the RSS path. |

### ⚠️ Lightning-address zap splits do not survive a round-trip

The writer and the reader disagree about where the split lives. `buildZapTags` emits a
**three**-element tag for a lightning address — `['zap', addr, split]`, split at index 2 —
while `parseNostrMusicEvent` unconditionally reads `parseInt(t[3])`. For a 3-element tag
that is `undefined` → `NaN` → `0`, and the recipient is then dropped by the
`splitPercentage > 0` filter. Only hex-pubkey recipients (4-element tags) come back.

This is a **code defect, described here as it currently behaves** — not the intended
design. It is the same shape of writer/reader disagreement that caused the `released`
date bug, so it is documented rather than papered over.

A related asymmetry: recipients that *do* survive are rebuilt by `buildValueBlockFromZaps`
as keysend **node** recipients with a fabricated `customKey` of `696969` and the pubkey as
`customValue`. So `customKey`/`customValue` are not merely lost in the RSS → Nostr
direction — they are *invented* coming back.

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
    ["released", "04/20/2026"],
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
| `album.op3` | OP3 prefix applied to `<enclosure url>` | *(not serialized)* | Analytics is an RSS-delivery concern. On import MSP sniffs an OP3 prefix on incoming Nostr URLs and re-enables `album.op3`, so feeds published by other tools keep their analytics setting. |
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
3. Convert `<pubDate>` (RFC-822) → `released` (`MM/DD/YYYY`, read out in UTC).
4. Convert `<itunes:duration>` to integer seconds.
5. Strip any `https://op3.dev/e…/` prefix from enclosure URLs. (MSP itself has nothing to strip — it stores the bare URL and applies the prefix only when generating RSS.)
6. Filter `<podcast:valueRecipient>` to only `lnaddress` or 64-hex-char `node` addresses; pick `[zap, addr, split]` vs `[zap, hex, relay, split]` based on format.
7. Flatten `<podcast:person>` into a `Credits:` block in the event `content`.
8. If 2+ tracks, build one kind 34139 event with `["a","36787:<pubkey>:<guid>"]` references in track order; d-tag = `<podcast:guid>`.

**Nostr Music → RSS**

1. Group kind 36787 events by their `album` tag. **MSP does not read kind 34139 at all** — it writes the playlist event but never queries for it (`fetchNostrMusicTracks` filters on the track kind only, and `groupTracksByAlbum` groups by the `album` tag). A consequence worth knowing: `<podcast:guid>` is *not* recovered on import, it is minted fresh by `createEmptyAlbum`, so an album's identity does not round-trip. An implementer who does read the playlist can use its `d` tag as `<podcast:guid>` and do better than MSP here.
   Tracks with no `album` tag are collected under the name `Singles`.
2. Channel: `album` → `<title>`, `artist` → `<itunes:author>`, `language` → `<language>`, `image` → `<itunes:image>`, playlist `description` → `<description>`, each `t` (except `music`) → `<itunes:category>`.
3. Item per track: `title` → `<title>`, `url` → `<enclosure url>` (Nostr carries no MIME type or byte length — supply `type="audio/mpeg"` as a sensible default and either HEAD-request the URL for `length` or omit/zero it; note MSP's generator does not substitute a default for missing `enclosureType`, so be explicit), `duration` → `<itunes:duration>`, `released` (`MM/DD/YYYY`) → `<pubDate>` (RFC-822, midnight UTC), `d` → `<guid isPermaLink="false">`, `image` → `<itunes:image href>`, `explicit=true` → `<itunes:explicit>true`.
4. Map `zap` tags back to `<podcast:valueRecipient>`. The originals' `customKey`/`customValue` are not recoverable — MSP substitutes a keysend `customKey` of `696969` with the pubkey as `customValue`. Read the lightning-address warning above before relying on this step: MSP's own reader drops 3-element `zap` tags.
5. Split the first paragraph of `content` before `Credits:` back into `<description>`; parse the `Credits:` lines into `<podcast:person>` entries (group/role/href/img not recoverable without extra conventions).
6. Fill `<podcast:medium>music</podcast:medium>` and set `<podcast:season>1</podcast:season>` + `<podcast:episode>{track_number}</podcast:episode>`. Season is hardcoded to `1`.

Other import-side limits worth knowing, all in `nostrMusicConverter.ts`: categories are truncated to the first **5**; a `duration` tag is ignored unless it is all digits; and the album description is synthesized from the first track that carries credits rather than read from a playlist event.

## Data loss, by direction

**Lost going RSS → Nostr:** transcripts/lyrics, funding, locked, publisher links, medium, owner contact info, keywords, managingEditor/webMaster, person `href`/`img`, value recipient `customKey`/`customValue`, enclosure `type` and `length`, OP3 routing, season, `<podcast:image>` additional artwork (`podcastImages`), any unknown-namespace elements.

**Lost going Nostr → RSS:** `client`, `alt`, `public`, NIP-09 deletion semantics (RSS has no "retract this item"), the cryptographic signature itself, the album's `<podcast:guid>` (regenerated, because MSP never reads the playlist event), and — through the defect noted above — every lightning-address zap split.

**Preserved on both sides:** track `guid` / `d`, title, enclosure/url, artist, album, track number, duration, explicit flag, release date, image, language, categories (as lowercased hashtags, first 5), and zap splits **for hex-pubkey recipients only**.

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
