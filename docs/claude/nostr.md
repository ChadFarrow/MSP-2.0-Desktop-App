# Nostr

Read this before touching Nostr signing, relays, event kinds, or the Nostr Music conversion.

## Event kinds

- 30054: full RSS XML in a parameterized-replaceable event, `d` = `podcastGuid` ("Save RSS feed to Nostr", cross-device sync). Read back by `loadAlbumsFromNostr` and `loadAlbumByDTag` (`src/utils/nostrSync.ts`).
- 36787 (track) + 34139 (playlist): Nostr Music. `publishNostrMusicTracks`, `fetchNostrMusicTracks` and `deleteNostrMusicTracks` in `nostrSync.ts`; converted back by `src/utils/nostrMusicConverter.ts`. Field mapping: `docs/rss-nostr-music-crossref.md`.
- 5 (NIP-09): "Unpublish (delete)" sends `a`-tag references to each track and the playlist. Relays may ignore it, so the UI says a deletion request was sent, never that the events are deleted.
- 1063 (NIP-94): the Blossom pointer, resolved by `api/feed/[npub]/[guid].ts`. 24242 (BUD-01): Blossom upload auth (`src/utils/blossom.ts`, `src/utils/nsite.ts`). 35128: the NIP-5A nsite manifest (`nsite.ts`).
- 34235/34236 (NIP-71): pasting an `naddr` (bare, `nostr:`, or inside a URL) into a video URL field fills URL, MIME type and duration (`src/utils/nostrVideoConverter.ts`, paste handler in `Editor.tsx`). It reads `imeta` and the legacy `url`, `m` and `duration` tags.

## Relays

- `DEFAULT_RELAYS` and `MUSIC_RELAYS` are in `src/utils/nostrRelay.ts`. The Nostr Music functions default to `MUSIC_RELAYS` (`DEFAULT_RELAYS` + `wss://drops.basspistol.org`). That relay accepts music kinds only: never send kind 0, 30054 or 1063 there.
- Kind 36787 carries no description, file size or required duration, so the Save gate's `nostrMusic` target (`getSaveBlockers` in `src/utils/feedChecks.ts`) skips those checks, which lets a round-tripped album republish.

## The `released` tag

`MM/DD/YYYY` in UTC on both ends: `formatReleasedDate` writes it (`nostrSync.ts`) and `parseReleasedDate` reads it (`nostrMusicConverter.ts`), both in `src/utils/dateUtils.ts`. Use UTC getters and `Date.UTC`; local getters put the date a day early west of Greenwich. The reader falls back to `DD/MM` only when the first field is above 12. Keep `dateUtils.test.ts` timezone-independent: a test that asserts a local date passes in one CI region and fails in another.

## Signing

- Never call `signer.signEvent()` or `signer.getPublicKey()` directly: an unreachable NIP-46 signer hangs the UI. Use `signEventWithTimeout()` and `getPublicKeyWithTimeout()` (`src/utils/nostrSigner.ts`; 60 s for NIP-46, 30 s for NIP-07). On timeout they reject with an "open your signer app and approve" message. NIP-46 has no cancel, so the request stays open on the signer.
- Before a user action that signs, call `checkSignerConnection()` and stop with `health.error` when `connected` is false. Callers: the Nostr save modes and Host on MSP while signed in with Nostr (`handleSave` in `SaveModal.tsx`, the reference), Link Nostr Identity, the "My Hosted Feeds" import list, "Browse My MSP Feeds", publisher Publish and the reminder section's hosting. It does not replace the timeouts:
  - NIP-07: a 3 s `getPublicKey` probe.
  - NIP-46 with an active signer: reports connected without a probe, because a reconnect would close the working connection and ask the user to approve again.
  - NIP-46 with no active signer: reconnects from the stored bunker pointer (30 s default).

## NIP-46 and nostr-tools

- Only the NIP-46 signer uses nostr-tools' relay code (`SimplePool` in `nostrSigner.ts`). Publishing, queries and the Blossom pointer use MSP's own sockets (`nostrRelay.ts`); Blossom uploads are HTTP. So a nostr-tools relay bug reaches NIP-46 users only. `nostrSigner.test.ts` runs the real pool and NIP-46 code on an in-memory relay network.
- Tear a pool down with `pool.destroy()`, never `pool.close(NIP46_RELAYS)`: a `bunker://` URI can name other relays, and `close()` leaves their sockets open.
- `BunkerSigner.fromURI` gets `skipSwitchRelays: true`. The stored pointer names `NIP46_RELAYS`, so a signer that moved the session to its preferred relays could not be reached after a reload. To allow the switch, store `bunkerSigner.bp.relays` instead; the switch can land after `fromURI` resolves.
- `wss://relay.powr.build` is in `NIP46_RELAYS` for Clave (iOS), whose push proxy watches that relay to wake the app; without it a QR pairing connects and then hears nothing. With the signer on the same iPhone, `nostrconnect://` loses the reply because iOS suspends the page, so the connect modal sends those users to `bunker://`.
- All three connect flows get the public key through `requestPublicKey()`: re-sent every 15 s, given up after 60 s, with earlier requests still allowed to answer. A signer can miss one request.
- nostr-tools pins exact `@noble/*` versions, which are 2.x and export subpaths only with `.js` (`@noble/hashes/utils.js`). `@noble/hashes` is a direct dependency locked to the version nostr-tools pins, so the two dedupe; bump them together (a plain `npm i @noble/hashes` adds a second copy). Stay on nostr-tools 2.25.2 or later: earlier versions leak a WebSocket on each failed relay connect.
