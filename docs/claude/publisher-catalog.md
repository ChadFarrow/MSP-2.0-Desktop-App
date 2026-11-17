# Publisher catalog and publisher links

Read this before changing the publisher editor, the catalog flows (Publish, Download Catalog), `<podcast:publisher>` handling, or publisher roles.

## The rule

An artist must control every album in their publisher feed: only an album's editor can write its `<podcast:publisher>` link back, and that link proves the two belong together. Rules: `src/utils/publisherControl.ts`; design: `docs/superpowers/specs/2026-10-18-publisher-album-control-design.md`.

- MSP-hosted album: allowed; MSP writes the link back on Publish.
- Self-hosted album: allowed; the row reminds the artist to upload the Download Catalog copy. MSP blocks nothing.
- Wavlake or Fountain (`PLATFORM_HOSTS`, hostname or subdomain): refused in Search Directory results, because the platform writes the feed and can never carry a reliable link back. One already in the catalog stays, with a row warning and one Feed check item (`publisher-item-platform`; one, because `RemoteItem` has no stable id to follow through a reorder). Saving is never blocked. Moving instructions always say keep the GUID; a template (new GUID) makes a different album to apps.

## Link back

- A link back is a GUID match on any party (`sameGuid`: trimmed, case-folded, empty never matches). The URL is not compared: it may be an older address of the same publisher feed. `classifyLinkBack` / `classifyAlbumLinkBack` give `linked`, `other` (another publisher's GUID), `none` or `unknown`.
- Roles must agree (podcast-namespace PR #793): if both the album's party and the catalog row state `rel`, they must name the same token set, or apps discard the link. `withRoleCheck()` turns `linked` into `role-mismatch`. It runs when the status is shown (`entryFor` in `useLinkBackStatus.ts`), not when the album is read, because results are cached and the artist can change a row's role (or every row's, with "This publisher is") afterwards.
- Never overwrite another publisher's claim. Publish (`processCatalogFeed`) and Download Catalog skip an `other` album, and its reminder never says "upload". With beta on, both add this publisher after the others (`addParty`; `linkBackMessage(..., addsParty)` says so).

## When checks run (`src/components/Editor/PublisherEditor/useLinkBackStatus.ts`)

- Self-hosted checks go through `/api/proxy-feed` (no CORS on those hosts; 60/hour per IP), so only MSP albums are checked automatically - on open, after an import and after a publish (each bumps `publisherFeedInstance`) - read same-origin via `fetchCatalogFeedXml()`. A self-hosted album is checked when added or on "Check links back"; platform rows never. Results are session-only, keyed by publisher GUID + album URL.
- Read MSP albums with `cache: 'no-store'`: a cached read made a publish regenerate an album from its pre-edit XML and PUT it back.
- Take post-publish status from the publish results, never a re-read: the blob CDN can serve old XML for 60 s after a write. `PublishSection` calls `markLinked(linkedAfterPublish(...))` before re-dispatching the feed, and the automatic re-check skips rows marked linked.
- A skipped album is `neutral` (`catalogResultTone`), not an error. `summarizeCatalogUpdates` counts skips, so a run that updated nothing never reads "Complete".
- The Publish section shows when the catalog has any MSP album (`shouldShowPublishSection`) and skips the rest unfetched. With no `msp2-hosted-<guid>` record (it lives in one site address's localStorage), it updates as the signed-in Nostr, then email, owner, and skips on `isRefusal`. With a signer present it runs `checkSignerConnection()` first, since it may sign once per album.

## Feed-scoped local state: `publisherFeedInstance`

The publisher sections stay mounted across an import (`SET_PUBLISHER_FEED` only swaps data), so their `useState` survives into the next feed. `FeedState.publisherFeedInstance` is a counter bumped by `SET_PUBLISHER_FEED` and `CREATE_NEW_PUBLISHER_FEED`; `DownloadCatalogSection` and `PublisherFeedReminderSection` clear their URL fields and result banners when it changes (`useRef` compare). Do not key on `podcastGuid`: it is editable, so fields would clear on every keystroke. Any new section holding feed-scoped state (a URL, a banner, a submission result) needs the same reset; a stale Publisher Feed URL gets stamped into every catalog feed.

## Publisher Feed URL (`PublisherFeed.sourceUrl`)

Auto-fills Download Catalog's "Publisher Feed URL", the URL written into each catalog feed's `<podcast:publisher>`. Order: the URL the feed was imported from (`handleImport` in `App.tsx`) -> the feed's own `<atom:link rel="self">` (`parseSelfLink()`) -> the MSP hosted URL from the local hosted record for `podcastGuid`. Empty is valid for a self-hosted feed with no self link; never guess. `atom:link` is deliberately not in `KNOWN_CHANNEL_KEYS`, so it still round-trips. A template import deletes `sourceUrl`.

## `<podcast:publisher>` shape and round-trip safety

- An album's `<podcast:publisher>` wraps `<podcast:remoteItem medium="publisher">` (`generatePublisherXml()`); a publisher feed's own catalog is bare channel-level `remoteItem`s. The asymmetry is correct. The generator test asserts the whole nested block, so an empty wrapper with a sibling `remoteItem` cannot pass.
- An element is either modelled or passed through, never both:
  - A key in `KNOWN_CHANNEL_KEYS` that the parser does not read is deleted on parse -> regenerate (the key excludes it from `unknownChannelElements`), including in other people's album feeds. Never add a key without parsing it.
  - Albums use `ALBUM_CHANNEL_KEYS` (`KNOWN_CHANNEL_KEYS` minus `podcast:remoteItem`), so an album's podroll round-trips. The publisher parser keeps the full set; it parses those items into `remoteItems`.
  - A bare channel-level `remoteItem medium="publisher"` is consumed as a party and removed from the passthrough (`keepPassthrough`); otherwise it would be written twice. Other mediums round-trip.
- `parsePublisherReferences()` also reads attributes written directly on `<podcast:publisher>`, and repeated `remoteItem` children (fast-xml-parser gives an array, and `getAttr` on an array is `''`). The Feed check reports the non-standard shapes (wrapper attributes, a bare item, the same publisher twice) as `publisher-ref-shape`; several different publishers are not reported.

## Several publishers per album (`additionalPublishers`)

A proposal (PR #793; the spec says exactly one item), so the editing UI is beta, but the round-trip is not: never drop a party. Rules: `src/utils/publisherParties.ts`.

- `album.publisher` is the primary party, `album.additionalPublishers` the rest. `publisherParties()` is the one list everything reads; it skips a primary with neither GUID nor URL.
- One party per publisher: `samePublisher()` compares GUIDs, and URLs only when a GUID is missing. The parser keeps the first duplicate. Inside the wrapper, an item whose `medium` is neither `publisher` nor empty is not a party (every party is written back as `medium="publisher"`); a lone one is still read.
- The flows change only their own party (`linkPublisher()`): same publisher -> replaced in place; no publisher -> it becomes primary; parties with URLs only -> primary replaced; otherwise appended. The claim check above runs first.
- A Podcast Index lookup sets a GUID by URL, never by position (`SET_PUBLISHER_GUID` -> `withPartyGuid()`); the reducer drops a reply whose URL no longer names a party, and the Editor's lookup effect aborts on change. Writing the whole reference deleted an imported `rel`.
- One lookup (`src/utils/publisherLookup.ts`) serves every party. It takes a result only when its URL matches, or it is the single answer of an exact lookup: `/api/pisearch` full-text-searches a URL without `.xml`, `/feed` or `rss`.
- `rel` is a token set (`src/utils/publisherRole.ts`): split on spaces or commas; known tokens (`ROLE_TOKENS`) matched in any case and written lower-case in proposal order (`normalizeRel`); unknown tokens kept. `sameRoles` and `catalogRole` compare sets. MSP never writes a default role.
- Beta UI (`showBeta`): album editor `RolePicker` and "Other publishers" (`AdditionalPublishers.tsx`); catalog "This publisher is" (every row) and a `RolePicker` per row. Each shows with beta on or when the feed states that data; only "+ Add another publisher" needs beta. A `RolePicker` inside an "Other publishers" row takes `inBetaField` (no second box).

## Desktop App fork

`publisherControl.ts`, `publisherPublish.ts`, `CatalogFeedsSection.tsx`, `DownloadCatalogSection.tsx` and `PublisherFeedReminderSection.tsx` differ in the fork only by `apiFetch` lines; keep edits away from the fork's `apiFetch` import line, or the sync keeps the fork's whole file (`desktop-fork.md`). `withRole` keeps its name because the fork's `feedStore.tsx` imports it. The fork's album editor still uses its own `PublisherLookupSection.tsx`, which drops `rel` and takes the first search hit; a port mounts `RolePicker` and `AdditionalPublishers` and switches `publisherLookup.ts` to `apiFetch()`.
