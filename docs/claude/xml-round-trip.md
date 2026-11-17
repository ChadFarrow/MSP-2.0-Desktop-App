# XML parse, generate and round trip

Read this before you change `src/utils/xmlParser.ts`, `src/utils/xmlGenerator.ts`, a tag MSP models, or the feed corpus test.

## Files
- `xmlParser.ts` parses with fast-xml-parser, keeps unknown elements in passthrough maps (`unknownChannelElements`, `unknownItemElements`) and strips OP3 prefixes. `xmlGenerator.ts` writes the feed from the model and re-emits the passthrough.
- `fetchFeedFromUrl()`: the direct fetch is an optimisation only (needs CORS) and its failure never becomes the user's message. `/api/proxy-feed` is the one authoritative attempt; its `code` maps through `CODE_MESSAGES` (mirrors `ErrorCode` in `api/proxy-feed.ts`) into a `FeedFetchError`.
- **Do not add a third-party CORS proxy**: it leaks every user's feed URL. `fetchFeedFromUrl.test.ts` asserts no request leaves MSP.

## Passthrough rules
- **An element is either modelled or passed through, never both.** When the parser consumes an entry into a field, `keepPassthrough()` removes it from the passthrough, or the generator writes it twice. Cases: the first non-empty `podcast:txt purpose="npub"` (`artistNpub`), a bare channel `podcast:remoteItem medium="publisher"` (a publisher party), a `podcast:pinned` naming a track or catalog feed.
- **A key in `KNOWN_CHANNEL_KEYS` / `KNOWN_ITEM_KEYS` that is not parsed is deleted**, because the key is what keeps it out of the passthrough. Add a key only with its parser. Conversely a modelled element must be in the set (`podcast:image`, `podcast:alternateEnclosure`), or it is also captured as unknown and written twice. `podcast:txt` and `atom:link` are absent on purpose; `ALBUM_CHANNEL_KEYS` drops `podcast:remoteItem` so an album's podroll round-trips.
- **Values stay strings.** Every read uses `createFeedXmlParser()`, with number coercion off for text and attributes; with it on, number-shaped passthrough values (a txt token `0012345`, a valueTimeSplit `itemGuid`, a long id) changed on save. Do not turn it on, and do not build a second `XMLParser` in app code.
- **Templates drop the source's identity passthrough.** `withoutIdentityPassthrough()` (`regenerateGuids.ts`) removes every passthrough `podcast:txt`, every passthrough `podcast:pinned` and an `atom:link rel="self"`: in `regenerateAlbumGuids()` for album/video, in `handleImport` (`App.tsx`) for publisher templates.

## Harmless extras round-trip
Spec-valid tags with no editor must survive parse→regenerate unchanged.
- `fee="true"` on a recipient is `ValueRecipient.fee` (read and written, not editable).
- `<podcast:valueTimeSplit>` and other non-recipient children of `<podcast:value>` ride on `ValueBlock.unknownElements`. `areValueBlocksStrictEqual` compares them and `fee`, or a track block differing only by time splits gets `overrideValue = false` and inherits the channel block. `parseValueBlock` skips the capture when the node is an array (several value blocks), or it would emit `<0>`/`<1>`. Track recipient handlers in `Editor.tsx` spread `...track.value` so a split edit keeps it.
- Nested `<itunes:category>` is `subcategories`, written nested on the parent's first occurrence. `<podcast:locked>` without `owner` is written. `itunes:explicit` also reads Apple's legacy `yes`/`explicit`/`no`/`clean`.
- `feedImg` on a remote item is not in the spec but stays: `CatalogFeedsSection` and `DownloadCatalogSection` render thumbnails from `RemoteItem.image`. Do not drop it without moving that data.

## Generator conformance
- `<podcast:remoteItem>` `title` is an attribute. `parseRemoteItem` falls back to element text (older MSP feeds).
- `<image>` always gets the `<link>` RSS 2.0 requires: `imageLink`, else the channel `link`.
- Publisher feeds write `<atom:link rel="self">` from `sourceUrl` only, never a guess, and only when the passthrough has no `rel="self"` link. Album/video feeds write none.

## Recommended tracks and albums (`<podcast:pinned>`, proposed)
- A proposal (podcast-namespace discussion #570; may become `<podcast:sortOrder>`, #747). `generatePinnedXml()` is the only writer, so a spec change lands there.
- Album: each `Track.pinned` becomes a channel-level `<podcast:pinned guid="…"/>`, in track order. The parser reads `guid` or `itemGuid`; the generator writes `guid`. A pin naming a track is consumed into `track.pinned` (so it follows guid edits and `regenerateAlbumGuids()`); one naming no track passes through. It never touches `pubDate`.
- Publisher: `RemoteItem.pinned` becomes `<podcast:pinned feedGuid="…"/>` after the remote items. MSP's extension (a publisher feed has no episodes), named `feedGuid` so no app reads it as an episode guid. Only a `feedGuid` pin naming a catalog feed is consumed.
- Both parsers skip an empty key (a feedUrl-only remote item has `feedGuid: ''`).
- The "Recommended first listen" toggle shows when `showBeta` is on or the item is already pinned, so it never hides a tag that will be written.

## Listing (`<itunes:block>` / `<podcast:block>`)
The "Listing" select (`ListingSelect.tsx`, album and publisher editors) is how an artist takes a feed out of the indexes; deleting a feed or its enclosures leaves dead entries. `src/utils/listing.ts` maps three choices: **Listed** (no tag), **Hidden from podcast directories** (`<itunes:block>Yes</itunes:block>`; Apple and Podcast Index act on it, PI ignores `podcast:block`), **Hidden everywhere** (that plus a plain `<podcast:block>yes</podcast:block>`).
- Both tags are modelled in full, never passed through: `parseBlockTags()` reads `itunesBlock`, `podcastBlock` (no `id`) and `serviceBlocks` (every `<podcast:block id="…">`, verbatim). A repeated `<itunes:block>` arrives as an array, which `getText` reads as `''`, so read every entry.
- Only "yes" (any case) is a block; other plain values are dropped on import. `No`, empty and repeats get no Feed check line; another value (e.g. `true`) gets `block-value`. The corpus snapshot shows `podcast:block: 1 → 0` for corpus feeds that state `no`, the spec default.
- What the choices can't express (a plain `podcast:block` without `itunes:block`, or any service block) shows as **Custom** and is written back unchanged; picking a choice replaces every block tag (`listingFlags` returns `serviceBlocks: []`).
- A template starts Listed: `regenerateAlbumGuids` and the publisher template branch in `handleImport` apply `listingFlags('listed')`.
- A hidden hosted feed is pinged but not registered with Podcast Index: see `docs/claude/hosting-and-indexing.md`.

## Track lyrics (`<podcast:transcript>`)
"Lyrics URL", track-level. `TRANSCRIPT_TYPES` holds the spec's five types. `DEFAULT_TRANSCRIPT_TYPE` (`application/x-subrip`) is also the fallback for a missing `type`; a stated type is kept verbatim (the non-spec `application/srt` too, which the Feed check reports). Only one transcript per item is read.

## Value recipients on import
`parseRecipient()` is the one choke point for channel and track blocks. The type comes from the address (`detectAddressType()`: `@` means `lnaddress`), never from the `type` attribute. An address equal to `LEGACY_MSP_NODE_PUBKEY` (case-insensitive) becomes `MSP_SUPPORT_RECIPIENT` with the same split; match on the pubkey, not the name.

## Track order and item pub dates
Apps sort items newest-first, so track 1 needs the newest `pubDate`. Nothing sorts items; `src/utils/trackOrder.ts` keeps list position and dates in agreement.
- Stamp the date in the reducer, not in `createEmptyTrack`: `ADD_TRACK` overrides the payload's `pubDate` with `nextTrackPubDate()` (`TRACK_DATE_STEP_MS`, 60 s, older than the oldest track; the first gets `album.pubDate`).
- `REORDER_TRACKS` and `FIX_TRACK_ORDER` renumber `trackNumber`/`episode`, then run `resequenceTrackDates()`, or a reorder is invisible to apps.
- `resequenceTrackDates()` keeps the existing dates (sorted descending, handed out by index), so real episodic dates survive; only ties and unparseable dates are spread by `TRACK_DATE_STEP_MS`. It is idempotent, which makes it safe on the Track # input's per-keystroke `REORDER_TRACKS`.
- Imports are never rewritten silently. `trackOrderIssue()` returns `'reversed'` (all numbered, episodes descending) or `'dates'` (not strictly descending, ties included); `Editor.tsx` shows `.track-order-warning`, whose button dispatches `FIX_TRACK_ORDER`. `'reversed'` is checked first: the array is flipped before resequencing.
- `api/example-feed.ts` dates its items descending on purpose; keep it so.

## Alternate versions (`<podcast:alternateEnclosure>`)
UI in `src/components/AlternateEnclosuresList.tsx`; rules in `src/utils/alternateEnclosure.ts` (`urlChange`, `typeChange`, `createMeasurer`, `withMeasured`) so node tests cover them.
- Fields: Title, File Type, File Size, URL, and Height for a video version (a music video). No field for `default`, `rel`, `bitrate`, `lang`, `codecs`, integrity or mirrors, on purpose; all are kept from import and written back.
- **Album tracks only.** `editsAlternateVersions(album)` goes by `medium`, not feed slot (Load from Nostr puts a video feed in the album slot), and gates the editor, the Feed check and the link check alike, so nothing is reported without a field to fix it.
- **Beta.** `showsAlternateVersions(album, track, showBeta)`: beta on, every album track; beta off, only tracks that already have a version, with "+ Add" hidden (`canAdd={showBeta}`). Never hide existing versions: the generator writes them and the checks report them.
- **The URL is the first `<podcast:source>`.** The generator leaves out a version whose first source is blank, mirrors or not (Feed check: `alt-enclosure-no-url`). URL rules and the link check read the first source only and skip a non-web one (`NON_WEB_SOURCE_RE`: `ipfs:`, `ipns:`, `magnet:`, `ar:`). OP3 never prefixes a non-web source.
- **Type** follows a recognized extension until the user picks one (`typeSetByHand`, never written). A URL sets a video type only from its final extension (`matchVideoExtension`); `isVideoUrl`/`getVideoMimeType` keep match-anywhere for the video-feed paths. `typeChange` drops `codecs` on a new type, and `height` unless it is video.
- **A URL edit** (`urlChange`, once per keystroke) drops `length`, `bitrate`, `height`, `codecs`, the first source's attributes and `<podcast:integrity>`, and keeps them in `originalFile` (never written); an edit back to that URL restores them. A whitespace-only edit changes only the text. There is no duration-based size estimate: `length` is optional here.
- **Measured values**: size from a HEAD `Content-Length` (`detectMediaSize`, needs CORS), video height from `<video>` metadata (`detectVideoHeight`, works cross-origin), read on paste and blur into an empty field only. Previews use `preload="none"` so a URL being typed is not fetched.
- **A measurement can land ~10 s late, so it never goes through `onChange`** (which carries the track index from its render). `onMeasured` dispatches `SET_ALTERNATE_ENCLOSURE_MEASURED { trackId, versionId, url, field, value }`; the reducer finds both by id and applies `withMeasured`, which refuses when the version is gone, its URL changed, or the field was typed meanwhile. Rows are keyed by `AlternateEnclosure.id` (never written).
- **Round trip**: `<podcast:integrity>` and other non-`source` children ride on `unknownElements`, unknown attributes on `unknownAttributes` (version and each source); a modelled element never reaches the item passthrough, so anything not captured is lost. A version MSP can't read (no `type`, or no source with a `uri`) stays in the item passthrough.
- **OP3**: sources are stored bare and prefixed on save when OP3 is on. Strip on import (and in the localStorage migration) only when the main enclosures carried OP3 (`album.op3`); otherwise the prefix round-trips, and `regenerateAlbumGuids` drops it from a template.
- **Old localStorage**: `migrateStoredAlternateEnclosures()` (from `migrateAlbum` in `storage.ts`) moves versions stored in `unknownItemElements` into `alternateEnclosures`; without it the generator writes copies the editor never shows.
- **Desktop App fork**: it edits tracks in its own `TracksSection.tsx`, which writes the gate inline (`!isVideo && (showBeta || …)`, `canAdd={showBeta}`). Any change to the gate, the mount, `onMeasured` or another track-level control (such as "Recommended first listen") needs the same hand edit there; a new reducer action needs a port to its forked `feedStore.tsx`.

## Enclosure file size (`<enclosure length>`)
- The attribute is **bytes**.
- `detectMediaSize()` (`audioUtils.ts`) reads `Content-Length` from a HEAD request. It is CORS-safelisted: any host with `Access-Control-Allow-Origin` works. 10 s timeout; resolves `null`, never rejects.
- `resolveMediaSize(url, durationSeconds?)`: the measured size, else a 128 kbps estimate from duration, else ~5 MB. Only the first is a measurement.
- The parser drops a length below `MIN_PLAUSIBLE_MEDIA_BYTES` (1024) as unknown, so placeholders such as `33` don't propagate. `backfillEnclosureSizes()` (`App.tsx`) then measures missing sizes after import, one `UPDATE_TRACK` per track; without it the user gets an empty required field.

## `<podcast:image>` (additional images)
Extra artwork (banner, canvas, social…) at feed and track level, separate from the cover (`imageUrl`/`trackArtUrl`).
- `podcastImages` on `Album`, `Track`, `PublisherFeed`, `BaseChannelData`; publisher feeds have feed-level images only. `PODCAST_IMAGE_PURPOSES` feeds the purpose dropdown.
- `podcast:image` must stay in both key sets. The legacy plural `<podcast:images>` is read into `trackArtUrl` and never written; `trackArtWidth`/`trackArtHeight` are parsed but nothing reads them.
- UI: `PodcastImagesList.tsx` (`detectImageMetadata()` fills size, ratio and MIME). Edits replace the whole array through `UPDATE_ALBUM`/`UPDATE_TRACK`/`UPDATE_PUBLISHER_FEED`.

## OP3 analytics
`Album.op3` is the Album/Video Info toggle. `applyOp3Prefix()` writes `https://op3.dev/e,pg={podcastGuid}/…` on enclosures (drops `https://` from the target, keeps `http://`); `stripOp3Prefix()` removes it on import and sets `album.op3`. The stats link under the toggle (`Op3StatsLink`, `Editor.tsx`) asks `/api/op3check?guid=` first.

## Feed corpus round trip
`src/utils/feedCorpus.roundTrip.test.ts` imports every feed in `src/test/feed-corpus/` plus the root `example-feed.xml` and saves it as the app does (`importLikeApp` mirrors `handleImport`, `saveLikeApp` mirrors SaveModal). It is hermetic and runs in `npm run test`, unlike the opt-in `api/_utils/feedCorpus.network.test.ts`.
- A second save must give the bytes of the first (hard assert).
- A snapshot pins the report per element/attribute path (`lost`, `added`, `changed`), so a new loss fails. Accept a deliberate change with `npx vitest run src/utils/feedCorpus.roundTrip.test.ts -u`, and say in the PR why each new line is right.
- **Never edit a corpus file by hand.** `tools/fetch-feed-corpus.mjs` is the only writer (usage in `src/test/feed-corpus/README.md`); it records each SHA-256 in `manifest.json` and the test refuses a mismatch. If a feed breaks MSP, fix MSP. Take URLs from musicindex-studio's corpus, never its files (AGPL-3.0).
- Files load with `import.meta.glob` `?raw`, not `node:fs`: `tsconfig.app.json` types only `vite/client`, and the Desktop App runs `src/` tests under jsdom.
- The test fakes `Date` and stubs `crypto.randomUUID` (parser defaults for a missing `pubDate` or guid). A new non-deterministic parser default needs the same, or the snapshot flaps.
