# Publisher Catalog: Only Albums the Artist Controls — Design

**Date:** 2026-10-18
**Branch:** `feat/publisher-album-control` (from `master`)

## Context

A publisher feed lists albums (`<podcast:remoteItem>`), and each album is meant to point back with `<podcast:publisher>`. The link back is what proves the two belong together, and only someone who can edit the album feed can write it. Chad's rule (2026-10-18): **an artist must be in control of every album in their publisher feed — they can't use albums they can't edit.**

What prompted it, from real feeds checked on 2026-10-18:

- **Strange Love** (`e3e2e758…`) has three MSP-hosted albums that all point back. Their three Wavlake albums point to Wavlake's own artist page (`19a8b788…`), and Strange Love cannot change that — Wavlake writes those files.
- **Longy - Everything** (PI 7696544, `headstarts.uk`) lists 24 albums: 13 self-hosted on `headstarts.uk` (11 point back; "Into the Valueverse 1" points to Nathan Abbott's publisher feed `c0d95236…`; "Into the Valueverse - Full Show", made with Sovereign Feeds, has no publisher tag) and **11 on Wavlake**. The Wavlake ones "point back" only because Longy's MSP-made publisher feed reuses the GUID of Longy's Wavlake artist page (`4d25f0dd…`); the `feedUrl` in each Wavlake album still names `wavlake.com/feed/artist/…`. It works only while Wavlake's artist page stays out of Podcast Index.
- **New Music Nudge Unit** (`headstarts.uk`) is the model of a self-hosted catalog: albums made in MSP, uploaded by the artist to their own host, each carrying a correct `<podcast:publisher>` (GUID and URL).

## How MSP judges an album

| Result | When | What the row shows |
|---|---|---|
| **Allowed — on MSP** | Album is MSP-hosted (`isMspHosted`, `publisherPublish.ts`) | Linked, or "MSP adds the link back when you publish". MSP does the work (Goal 4). |
| **Allowed — self-hosted** | Album is on any other host; the artist uploads the file themselves | Linked, or a reminder: upload the new version (from Download Catalog) to your host. **MSP trusts the artist; nothing is blocked.** |
| **Allowed — claimed by another publisher** | The album's live feed names a different publisher GUID | A warning naming that publisher. **No upload reminder**: an album names one publisher, and the Download Catalog copy would replace that claim (Chad, 2026-10-18). |
| **Refused** | Album URL is on a platform that writes the feed for the artist: **Wavlake and Fountain** (Chad, 2026-10-18) | Not added (new) or a warning (already in the catalog). See "Moving a platform album". |

An MSP album owned by someone else can't be written by this artist, so publishing skips it and it stays "not linked yet". No special rule.

## Goals

1. **Refuse new Wavlake and Fountain albums** on every path that adds a catalog item from a URL — today the Podcast Index search ("Search Directory") results.
2. **Keep existing ones, with a warning** (Chad, 2026-10-18). An imported publisher feed that already contains Wavlake/Fountain albums keeps them; each such row shows a warning, and the Feed check panel shows one "Should fix" item. Saving is **not** blocked.
3. **Show link-back status** for every other album, so the artist sees which still need work and what kind.
4. **Make "MSP albums are automated" true** (Chad: "MSP hosted feeds are basically automated for the user"). Two things stop it today, and both are in scope:
   - **The Publish section hides itself** when any catalog album is not MSP-hosted (`PublisherEditor/index.tsx:31`, `allFeedsHosted`). It must show whenever the catalog has at least one MSP-hosted album, publish the publisher feed, write the link back into the MSP albums it can write, and skip every other album **without fetching it** (each fetch of a non-MSP album costs a proxy call and then ends in "No credentials" anyway).
   - **Writing an MSP album needs that album's browser record** (`processCatalogFeed` → `getHostedFeedInfo`, `publisherPublish.ts:278`), which is per site address — the same cause as the Save modal bug fixed on `fix/save-modal-owner-retry`. With no record, it must try the signed-in Nostr then email owner, as that fix does (`createOrClaimHostedFeed` there; reuse the same detection of 401/403). An album this identity doesn't own is skipped, not an error.

## Moving a platform album (refusal and warning text)

The message tells the artist to **keep the album's GUID** (Chad, 2026-10-18): import the album into MSP (Import from URL keeps `podcastGuid`), host it on MSP or on their own host, then **remove the Wavlake/Fountain copy, or ask the platform to remove it** — otherwise two live feeds share one GUID, as Strange Love's *Live at Rockpile* does today. Then delete the old row (an existing one) and add the new copy from search. Not "use as a template": a new GUID makes it a different album to apps and drops its Podcast Index entry and boost history. MSP can't know whether a given artist can delete an album on the platform, so the text says "remove, or ask the platform to remove".

## Non-goals

- Proving ownership of a self-hosted album any other way than the link back.
- Blocking or gating any save, publish or download.
- Removing items automatically.
- A way to change a catalog row's URL in place; delete and re-add is enough. *(My call.)*
- The other problems found during this investigation (listed at the end).

## Anti-goals (a failure even if it technically works)

- Breaking or blocking a catalog that works today. Longy's feed must still open, edit, save and publish with its 11 Wavlake albums in it.
- Calling a self-hosted album "refused", or wording a reminder as an error. Only Wavlake/Fountain are refused.
- Telling an artist to upload a copy that takes an album away from another publisher.
- Spending the `/api/proxy-feed` budget (60 requests/hour per IP, `api/proxy-feed.ts:40`) by checking every album on every open. `headstarts.uk` sends no CORS header, so each self-hosted check goes through the proxy, and `fetchFeedFromUrl` (`xmlParser.ts:915`) sends MSP URLs through it too. One open of Longy's feed would cost 13 calls.

## Decided

- **Platform list:** `wavlake.com` and `fountain.fm`, matched on the URL's hostname: equal to the domain or ending in `.` + domain (so `www.wavlake.com` and `feeds.fountain.fm` match; `notwavlake.com` does not). One exported constant, so a host can be added later. An unparsable URL is not a platform match. *(Matching rule: my call.)*
- **Refusal in the search results:** the result still shows, with its Add button disabled and the reason beside it, rather than being hidden — so the artist learns why. *(My call.)*
- **Where existing-item warnings appear:** on each catalog row (next to the existing `⚠` URL-problem line, `CatalogFeedsSection.tsx:547`), and as **one** Feed check "Should fix" item in `getShouldFixIssues` (`feedChecks.ts:216`) that names the affected albums by title and count, in area `catalog`. One item, not one per album: `RemoteItem` has no stable id and `issueLocationLabel` reports every `catalog` issue as "Catalog Feeds", so a per-album item would need an id added to the type, the parser, the reducer, stored localStorage data and the Desktop fork. The per-album detail lives on the rows. Both are URL-only, so they need no fetch and show immediately. *(My call.)*
- **Link back = GUID match.** An album is linked when its parsed `<podcast:publisher>` (`parsePublisherReference`, `xmlParser.ts:683`) names this publisher's `podcastGuid` (trimmed, case-insensitive). The URL inside the tag is not compared: Wavlake/Fountain are refused anyway, and a self-hosted album's URL may legitimately be an older address of the same publisher feed. *(My call.)*
- **Statuses:** linked · claimed by another publisher · no publisher tag · could not check · not checked yet; plus the platform warning, which needs no fetch. *(My call.)*
- **When it checks:** a newly added album is checked once, right after it is added; the whole list only when the artist presses "Check links back"; and the MSP albums again after a publish, since publishing may have just linked them. Results live for the session, keyed by feed URL, and are not persisted. *(My call.)*
- **Fetching MSP-hosted albums** for the check uses the same-origin path `/api/hosted/{feedId}.xml` (as `ImportModal` does), not `fetchFeedFromUrl`, so MSP rows cost no proxy calls. *(My call.)*
- **Download Catalog** still offers a copy of a "claimed by another publisher" album, but shows the same warning beside it, so the artist decides knowingly. *(My call.)*
- **Base branch:** `master`, not `FAFO`. `FAFO` carries ~30 unmerged commits that touch `feedChecks.ts`, `feedStore.tsx`, `linkCheck.ts` and `xmlParser.ts`; stacking on it is what `CLAUDE.md` warns against. Line references here are `master`'s. Expect a small merge in `feedChecks.ts` whichever lands second. Goal 4's owner fallback reuses the helper from `fix/save-modal-owner-retry`, so that branch should merge first, or this one carries its own copy that is byte-identical. *(My call.)*

## Left to the builder

- File layout: one pure module in `src/utils/` (e.g. `publisherControl.ts`) holding the platform constant, `getPlatformHost(url)` and the link-back classification, with the browser fetch outside it so the logic is unit-testable in node.
- Whether to also guard `ADD_REMOTE_ITEM` in `feedStore.tsx`. The reducer can't show a message, so a guard there is only a silent backstop; the UI refusal is the real one.
- Fetch concurrency for "Check links back" (a small pool, as `runLinkCheck` in `linkCheck.ts:87` uses).
- Exact copy for messages, within the rules above.

## Testing

Vitest runs in node with no DOM. Unit tests for:
- `getPlatformHost`: `wavlake.com`, `www.wavlake.com`, `feeds.fountain.fm`, lookalikes (`notwavlake.com`, `wavlake.com.evil.example`), MSP URLs, `headstarts.uk`, invalid and empty URLs.
- Link-back classification from album XML: linked, claimed by another publisher, none, GUID case/whitespace, unparsable XML → could not check.
- The Feed check rule: fires for Wavlake/Fountain catalog items (one item, all titles), not for MSP or self-hosted.
- The Publish-section gate: visible with one MSP album among others; hidden with none.
- `processCatalogFeed` / the publish loop: a non-MSP album is skipped without a fetch; an MSP album with no browser record is updated as the signed-in owner; a 403 skips it.
- Real-data fixtures worth keeping: one Longy Wavlake album (points to `4d25f0dd…` through a `wavlake.com/feed/artist` URL), one NMNU album (points back with a `headstarts.uk` URL), and "Into the Valueverse 1" (claimed by another publisher).

Manual check in a browser: import Longy's feed → it opens with the warnings, saves, and the Publish section shows; search Podcast Index for a Wavlake album → Add is disabled with the reason; add a `headstarts.uk` album → the upload reminder shows and the check reports its real status; publish a catalog with an MSP album from a browser that has no record of it → the album gets the link back.

## Desktop App fork

`CatalogFeedsSection.tsx`, `PublisherEditor/index.tsx`, `PublishSection.tsx`, `publisherPublish.ts`, `feedChecks.ts` and the new util are not on the fork's diverged-file list, so they should sync on their own. `CLAUDE.md` is diverged; its note needs a port there.

## Found during the investigation, out of scope here

- **"+ Add Feed"** (`CatalogFeedsSection.tsx:674`) adds a row whose fields are all disabled, so it can only be deleted.
- **"Browse My MSP Feeds"** builds item URLs from `window.location.origin` instead of `buildHostedUrl`, which is how the Strange Love catalog came to list `new.musicsideproject.com` and `msp.podtards.com` URLs.
- **The search Add has no duplicate check**, so the same album can be added twice.
- **The same GUID on two live feeds**: Strange Love's *The EP (Amnesia)* and *Live at Rockpile* use the same GUIDs on MSP and on Wavlake.
- **`hostCatalogFeeds` is hardcoded to `false`** (`PublishSection.tsx:123`).
