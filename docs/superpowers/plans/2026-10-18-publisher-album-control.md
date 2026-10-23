# Publisher Album Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A publisher catalog accepts only albums the artist controls: Wavlake/Fountain albums are refused when added and warned about when already present; every other album shows whether it points back; and publishing writes the link back into MSP albums even in a mixed catalog and from a browser with no record of them.

**Architecture:** One pure module, `src/utils/publisherControl.ts`, owns the platform list, MSP-URL helpers, the link-back classification and all user-facing copy. `publisherPublish.ts` uses it to skip non-MSP albums without fetching, to fetch MSP albums same-origin, to leave albums claimed by another publisher alone, and (with `claimHostedFeed.ts` from the Save modal fix) to update an MSP album as its signed-in owner. A hook in the publisher editor keeps per-session link-back results and feeds both the catalog list and Download Catalog.

**Tech Stack:** React 19, TypeScript 5.9 (strict), Vitest 4 (node, no DOM), fast-xml-parser via `parseRssFeed`.

**Spec:** `docs/superpowers/specs/2026-10-18-publisher-album-control-design.md`

## Global Constraints

- Platform list is exactly `wavlake.com` (name `Wavlake`) and `fountain.fm` (name `Fountain`), matched when `URL.hostname` equals the domain or ends with `.` + domain.
- Nothing in this work blocks or gates a save, publish or download.
- Link back = the album's parsed `<podcast:publisher>` `feedGuid` equals the publisher's `podcastGuid`, trimmed and case-insensitive. Two empty GUIDs never match.
- No fetch for a platform row. MSP rows fetch the same-origin path `/api/hosted/{feedId}.xml`. Self-hosted rows are fetched only right after being added, or when the artist presses "Check links back".
- Moving copy always says: keep the GUID, and "remove the {name} copy, or ask {name} to remove it". Never "use as a template".
- An album that names another publisher is never overwritten by MSP and never gets an "upload" reminder.
- Verify with `npm run build`, `npm run test`, `npm run lint`. Never `tsc --noEmit` (it checks zero files here).
- Commits are imperative and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code comments in the repo's normal style (CLAUDE.md's STE rule is for chat only).

## Review Focus

1. **A catalog row with no feed URL** (the "+ Add Feed" blank row): no platform warning, no fetch, no crash. → Task 1 test `checkAlbumLinkBack never fetches a row with no URL`.
2. **Feed URLs with spaces**, as NMNU's `headstarts.uk/msp/fable music/…` really are: `getPlatformHost` must not throw and must not match. → Task 1 test `handles a URL with spaces`.
3. **Host spelling**: `https://WWW.Wavlake.com:443/feed/…` is still Wavlake; `wavlake.com.evil.example` and `notwavlake.com` are not. → Task 1 tests.
4. **Non-canonical publisher shapes** in album feeds (attributes directly on `<podcast:publisher>`): classification follows `parseRssFeed`, so it reads them. → Task 1 test `reads the attribute form`.
5. **A publisher with an empty GUID** (a new feed): nothing classifies as linked. → Task 1 test `never links on an empty GUID`.

---

### Task 1: `publisherControl.ts` — platform hosts, link-back classification, copy

**Files:**
- Create: `src/utils/publisherControl.ts`
- Create: `src/utils/publisherControl.test.ts`
- Modify: `src/utils/publisherPublish.ts:63-78` (delete the local `isMspHosted` and `extractFeedIdFromUrl`; import them from the new module)

**Interfaces:**
- Produces:
  - `interface PlatformHost { domain: string; name: string }`
  - `const PLATFORM_HOSTS: readonly PlatformHost[]`
  - `getPlatformHost(url: string | undefined): PlatformHost | null`
  - `isMspHosted(url: string): boolean` and `extractFeedIdFromUrl(url: string): string | null` — moved verbatim from `publisherPublish.ts`
  - `sameGuid(a: string | undefined, b: string | undefined): boolean`
  - `type LinkBackResult = { status: 'linked' } | { status: 'other'; publisherGuid: string; publisherUrl?: string } | { status: 'none' } | { status: 'unknown' }`
  - `classifyLinkBack(xml: string, publisherGuid: string): LinkBackResult`
  - `fetchCatalogFeedXml(feedUrl: string): Promise<string>` — MSP URL → `fetch('/api/hosted/' + feedId + '.xml')` (throw on `!ok`); otherwise `fetchFeedFromUrl(feedUrl)`
  - `checkAlbumLinkBack(item: RemoteItem, publisherGuid: string, fetchXml?: (feedUrl: string) => Promise<string>): Promise<LinkBackResult>` — default `fetchXml` is `fetchCatalogFeedXml`; returns `{ status: 'unknown' }` without calling `fetchXml` when `item.feedUrl` is empty or a platform host; any thrown error → `unknown`
  - Copy: `platformRefusal(host: PlatformHost): string`, `platformWarning(host: PlatformHost): string`, `linkBackMessage(result: LinkBackResult, onMsp: boolean): string`

- [ ] **Step 1: Write the failing tests** in `src/utils/publisherControl.test.ts`:

```ts
describe('getPlatformHost', () => {
  it.each([
    ['https://wavlake.com/feed/music/a82acc2f-3440-491c-94c2-d27bebf6cfe6', 'Wavlake'],
    ['https://www.wavlake.com/feed/36639728-9454-40d9-8354-c91bc9939f1e', 'Wavlake'],
    ['https://WWW.Wavlake.com:443/feed/x', 'Wavlake'],
    ['https://feeds.fountain.fm/WmsWR5Ohttd6cuxfRdHt', 'Fountain'],
  ])('matches %s', (url, name) => expect(getPlatformHost(url)?.name).toBe(name));
  it.each([
    'https://notwavlake.com/feed.xml',
    'https://wavlake.com.evil.example/feed.xml',
    'https://musicsideproject.com/api/hosted/27735a10-3775-503d-b038-70b4b7d536ab.xml',
    'https://headstarts.uk/msp/longy/Lady/Lady-You-Shot-Me.xml',
    '', 'not a url', undefined,
  ])('does not match %s', url => expect(getPlatformHost(url)).toBeNull());
  it('handles a URL with spaces', () =>
    expect(getPlatformHost('https://headstarts.uk/msp/fable music/the raven/the raven.xml')).toBeNull());
});

describe('classifyLinkBack', () => {
  const PUB = '4d25f0dd-9270-4fb7-8aeb-ddd4a5213585';
  // album(publisherBlock) builds a minimal valid album RSS string around the given block
  it('is linked when the GUID matches', …expect(classifyLinkBack(album(nested(PUB)), PUB)).toEqual({ status: 'linked' }));
  it('ignores case and whitespace in the GUID', … nested(` ${PUB.toUpperCase()} `) → linked);
  it('is linked through a wavlake.com/feed/artist URL (the URL is not compared)', …);
  it('reports another publisher', … nested('c0d95236-3400-43e6-9721-d3904f182767') → { status: 'other', publisherGuid: 'c0d95236-…', publisherUrl: <the tag's feedUrl> });
  it('reports no publisher tag', … album('') → { status: 'none' });
  it('reads the attribute form', … '<podcast:publisher feedGuid="…" feedUrl="…" medium="publisher"/>' → linked);
  it('never links on an empty GUID', … classifyLinkBack(album(nested('')), '') → not linked);
  it('reports unreadable XML as unknown', … classifyLinkBack('<html>', PUB) → { status: 'unknown' });
});

describe('checkAlbumLinkBack', () => {
  it('never fetches a row with no URL', … fetchXml = vi.fn(); result unknown; fetchXml not called);
  it('never fetches a platform row', … feedUrl wavlake → fetchXml not called);
  it('classifies what it fetched', … fetchXml resolves album(nested(PUB)) → linked);
  it('reports a failed fetch as unknown', … fetchXml rejects → unknown);
});

describe('copy', () => {
  it('tells the artist to keep the GUID and remove the platform copy', () => {
    const wavlake = PLATFORM_HOSTS[0];
    for (const text of [platformRefusal(wavlake), platformWarning(wavlake)]) {
      expect(text).toContain('keep its GUID');
      expect(text).toContain('remove the Wavlake copy, or ask Wavlake to remove it');
      expect(text).not.toMatch(/template/i);
    }
  });
  it('never asks for an upload when another publisher has the album', () =>
    expect(linkBackMessage({ status: 'other', publisherGuid: 'x' }, false)).not.toMatch(/upload/i));
});
```

Use the real-data fixtures from the spec: a Longy Wavlake album's tag (`feedGuid="4d25f0dd-…"`, `feedUrl="https://wavlake.com/feed/artist/4d25f0dd-…"`), an NMNU album's tag (`feedUrl="https://headstarts.uk/msp/publisher-feeds/…"`), and "Into the Valueverse 1" pointing to `c0d95236-3400-43e6-9721-d3904f182767`.

- [ ] **Step 2: Run** `npx vitest run src/utils/publisherControl.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/utils/publisherControl.ts`.** `getPlatformHost` parses with `new URL` in a try/catch and compares `hostname`. `classifyLinkBack` calls `parseRssFeed(xml)` in a try/catch and reads `album.publisher`. Move `isMspHosted` / `extractFeedIdFromUrl` here unchanged and import them in `publisherPublish.ts`. Exact copy:
  - `platformRefusal`: `Hosted on ${name}. ${name} writes this feed for you, so it can't point back to your publisher feed. To use this album: import it into MSP from its URL (that keeps its GUID), host it on MSP or on your own host, then remove the ${name} copy, or ask ${name} to remove it. Then add the new copy here.`
  - `platformWarning`: `Hosted on ${name}. You can't edit this feed, so it can't reliably point back to this publisher feed. To fix it: import the album into MSP from its URL (that keeps its GUID), host it on MSP or on your own host, remove the ${name} copy, or ask ${name} to remove it, then delete this row and add the new copy from Search Directory.`
  - `linkBackMessage`: `linked` → `Points back to this publisher feed.`; `none` + `onMsp` → `Not linked yet. MSP adds the link back when you publish.`; `none` + not on MSP → `Not linked yet. Download this album's new version in Download Catalog and upload it to your host.`; `other` → `This album names a different publisher feed (${publisherGuid}). An album can name only one publisher, so MSP leaves it alone. Ask the owner of that publisher feed if it should move.`; `unknown` → `Couldn't read this album's feed. Try "Check links back" again later.`

- [ ] **Step 4: Run** `npx vitest run src/utils/publisherControl.test.ts` — Expected: PASS. Then `npm run build` — Expected: `✓ built` (proves the moved helpers still resolve in `publisherPublish.ts`).

- [ ] **Step 5: Commit** — `git add src/utils/publisherControl.ts src/utils/publisherControl.test.ts src/utils/publisherPublish.ts && git commit -m "Classify catalog albums by host and by whether they point back"`

---

### Task 2: Feed check item for Wavlake/Fountain albums

**Files:**
- Modify: `src/utils/feedChecks.ts:20-66` (add `'publisher-item-platform'` to `IssueCode` under "Should fix — live rules"), `src/utils/feedChecks.ts:222-228` (publisher branch of `getShouldFixIssues`)
- Test: `src/utils/feedChecks.test.ts` (inside `describe('getShouldFixIssues')`)

**Interfaces:**
- Consumes: `getPlatformHost` (Task 1)
- Produces: issue code `'publisher-item-platform'`, area `'catalog'`, level `'should'`

- [ ] **Step 1: Write the failing tests:**
  - `flags Wavlake and Fountain catalog albums in one item` — a publisher snapshot with 2 Wavlake items, 1 Fountain item, 1 MSP item, 1 `headstarts.uk` item → exactly one issue with code `publisher-item-platform`, area `catalog`, and a message containing `3 catalog albums` and each platform album's title.
  - `lists at most three titles` — 11 Wavlake items titled `A`…`K` → message contains `A, B, C and 8 more`.
  - `does not flag MSP or self-hosted albums` — only MSP + `headstarts.uk` items → no `publisher-item-platform` issue.

- [ ] **Step 2: Run** `npx vitest run src/utils/feedChecks.test.ts` — Expected: the three new tests FAIL.

- [ ] **Step 3: Implement** in the publisher branch. Title is `item.title || item.feedUrl`. Message (singular `album` when n = 1): `${n} catalog albums are hosted on Wavlake or Fountain (${titles}). You can't edit those feeds, so they can't reliably point back to this publisher feed. Each one's row in Catalog Feeds says how to move it; keep its GUID when you do.`

- [ ] **Step 4: Run** `npx vitest run src/utils/feedChecks.test.ts` — Expected: PASS, including the existing parity tests.

- [ ] **Step 5: Commit** — `git commit -am "Report Wavlake and Fountain catalog albums in the Feed check"`

---

### Task 3: Publish step — show it for mixed catalogs, skip what it can't write

**Files:**
- Modify: `src/utils/publisherPublish.ts` — export `processCatalogFeed` (`:278`); add `shouldShowPublishSection`
- Modify: `src/components/Editor/PublisherEditor/index.tsx:29-31,44` — use `shouldShowPublishSection(publisherFeed.remoteItems)`; drop the `getCatalogFeedsStatus` import if unused
- Create: `src/utils/publisherPublish.test.ts`

**Interfaces:**
- Consumes: `getPlatformHost`, `isMspHosted`, `extractFeedIdFromUrl`, `fetchCatalogFeedXml`, `sameGuid` (Task 1)
- Produces: `shouldShowPublishSection(remoteItems: RemoteItem[]): boolean`; exported `processCatalogFeed(item: RemoteItem, publisherGuid: string, publisherFeedUrl: string): Promise<FeedUpdateResult>`

- [ ] **Step 1: Write the failing tests** (mock `./hostedFeed`, `./nostrSigner` and `./publisherControl`'s `fetchCatalogFeedXml` with `vi.mock`; keep the real `getPlatformHost`):
  - `shouldShowPublishSection`: `true` for [MSP, Wavlake, headstarts]; `false` for [Wavlake, headstarts]; `false` for [].
  - `skips a self-hosted album without fetching it` → `status: 'skipped'`, message `Not on MSP: upload the new version from Download Catalog to your host`, fetch mock not called.
  - `skips a Wavlake album without fetching it` → message `Hosted on Wavlake: can't be updated`, not called.
  - `fetches an MSP album from its own path` → `fetchCatalogFeedXml` called with the item URL (which resolves to `/api/hosted/{id}.xml` inside it).
  - `leaves an MSP album that names another publisher alone` → album XML whose publisher is `c0d95236-…`; `status: 'skipped'`, message `Names a different publisher feed: left unchanged`; no update function called.
  - `still updates an MSP album it has a record for` → `getHostedFeedInfo` returns `{ feedId, editToken: 't' }`; `updateHostedFeed` called with the regenerated XML containing `<podcast:publisher>`; `status: 'updated'`.

- [ ] **Step 2: Run** `npx vitest run src/utils/publisherPublish.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `processCatalogFeed`, before any fetch: platform host → skipped with its message; `!isMspHosted(feedUrl)` → skipped (self-hosted message). Replace `fetchFeedFromUrl(feedUrl)` with `fetchCatalogFeedXml(feedUrl)`. After parsing, if `album.publisher?.feedGuid` is non-empty and `!sameGuid(album.publisher.feedGuid, publisherGuid)` → skipped, unchanged. The CORS branch in the catch stays as is.

- [ ] **Step 4: Run** `npx vitest run src/utils/publisherPublish.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src/utils/publisherPublish.ts src/utils/publisherPublish.test.ts src/components/Editor/PublisherEditor/index.tsx && git commit -m "Publish mixed catalogs and skip albums MSP can't write"`

---

### Task 4: Publish step — update an MSP album as its signed-in owner

**Files:**
- On branch `fix/save-modal-owner-retry` (worktree `.claude/worktrees/agent-aacc8b561bd116379`): `src/utils/claimHostedFeed.ts` — add `export` to `function isRefusal`; commit `Export the owner-refusal check for reuse`; build/test/lint there
- On this branch: bring `src/utils/hostedFeed.ts`, `src/utils/hostedFeed.test.ts`, `src/utils/claimHostedFeed.ts`, `src/utils/claimHostedFeed.test.ts` over **byte-identically** with `git checkout fix/save-modal-owner-retry -- <those four paths>` (so the later merge is an identical add/add, not a conflict)
- Modify: `src/utils/publisherPublish.ts` (`processCatalogFeed` credential block, `:316-357`)
- Test: `src/utils/publisherPublish.test.ts`

**Interfaces:**
- Consumes: `isRefusal(err: unknown): boolean` and `type HostedOwner` from `claimHostedFeed.ts`; `updateHostedFeedWithNostr(feedId, xml, title)`, `updateHostedFeedWithEmail(feedId, xml, title)` from `hostedFeed.ts`; `isEmailLoggedIn()` from `emailSession.ts`; `hasSigner()` from `nostrSigner.ts`
- Produces: nothing new for later tasks

- [ ] **Step 1: Write the failing tests:**
  - `updates an MSP album with no record as the Nostr owner` — `getHostedFeedInfo` → `null`, `hasSigner` → `true`; `updateHostedFeedWithNostr` called with the feed id; `status: 'updated'`.
  - `falls back to the email owner when Nostr is refused` — Nostr update rejects with `new HostedFeedError('Invalid credentials', 403)`, `isEmailLoggedIn` → `true`; email update called; `updated`.
  - `skips an album the signed-in account doesn't own` — every update rejects 403 → `status: 'skipped'`, message `Not owned by your signed-in account`.
  - `keeps "No credentials" when nobody is signed in` → `skipped`, `No credentials`, no update called.
  - `reports a non-refusal failure as an error` — Nostr update rejects `new HostedFeedError('Server error', 500)` → `status: 'error'`.
  - `uses the owner when the record has no usable credential` — record `{ feedId, editToken: '' }` with no `ownerPubkey` → owner path runs.

- [ ] **Step 2: Run** `npx vitest run src/utils/publisherPublish.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** Keep the record-based branch first (record matches feed id and has a Nostr owner with a signer, or a non-empty edit token). Otherwise build `owners: HostedOwner[]` — `'nostr'` when `hasSigner()`, `'email'` when `isEmailLoggedIn()` — and try each update in order; `isRefusal` moves to the next owner, any other error is rethrown into the existing catch. Success returns `updated` and fires the same background `notifyPodcastIndex` as the record branch.

- [ ] **Step 4: Run** `npm run test` — Expected: all pass, including the copied `claimHostedFeed`/`hostedFeed` tests. Then confirm the copies still match: `git diff fix/save-modal-owner-retry -- src/utils/hostedFeed.ts src/utils/hostedFeed.test.ts src/utils/claimHostedFeed.ts src/utils/claimHostedFeed.test.ts` — Expected: empty.

- [ ] **Step 5: Commit** — `git commit -am "Write the link back into MSP albums as their signed-in owner"` (include the four copied files)

---

### Task 5: Link-back status in the editor — refuse, warn, check

**Files:**
- Create: `src/components/Editor/PublisherEditor/useLinkBackStatus.ts`
- Modify: `src/components/Editor/PublisherEditor/index.tsx` — call the hook; pass its value to `CatalogFeedsSection` and `DownloadCatalogSection` as `linkBack`
- Modify: `src/components/Editor/PublisherEditor/CatalogFeedsSection.tsx` — search results (`:358-392`), `handleAddFromSearch` (`:213`), item rows (`:546-660`), a "Check links back" button above the list
- Modify: `src/components/Editor/PublisherEditor/DownloadCatalogSection.tsx` — row body (`:398-403`)

**Interfaces:**
- Consumes: Task 1's `getPlatformHost`, `isMspHosted`, `checkAlbumLinkBack`, `platformRefusal`, `platformWarning`, `linkBackMessage`, `LinkBackResult`
- Produces:
  ```ts
  export interface LinkBackState {
    statusFor(item: RemoteItem): LinkBackResult | 'checking' | undefined;
    checkItems(items: RemoteItem[]): Promise<void>;
    checkAll(): Promise<void>;
    checkingAll: boolean;
  }
  export function useLinkBackStatus(publisherFeed: PublisherFeed, feedInstance: number): LinkBackState
  ```

- [ ] **Step 1: Implement the hook.** Results in `useState<Record<string, LinkBackResult | 'checking'>>`, keyed `` `${publisherFeed.podcastGuid}|${item.feedUrl}` `` so a different publisher feed never sees another's results. `checkAll` skips platform rows and rows with no URL, and runs at most 3 checks at once. An effect on `feedInstance` (bumped by import **and** by `PublishSection`'s post-publish `SET_PUBLISHER_FEED`) calls `checkItems` on the MSP rows only — same-origin, no proxy cost. No effect checks self-hosted rows.

- [ ] **Step 2: Catalog search results.** For a result whose `url` is a platform host: the Add button is `disabled`, its label is `Can't add`, and `platformRefusal(host)` shows under the title. `handleAddFromSearch` returns early for a platform host (backstop), and after dispatching calls `linkBack.checkItems([newItem])`.

- [ ] **Step 3: Catalog rows.** Platform row → `⚠ ` + `platformWarning(host)` in the existing warning style (`:652-656`). Otherwise, when `statusFor(item)` is a result → `linkBackMessage(result, isMspHosted(item.feedUrl ?? ''))` (muted for `linked`, warning colour otherwise); `'checking'` → `Checking…`. Above the list: a `btn btn-secondary` "Check links back" button, disabled while `checkingAll` or when the catalog is empty.

- [ ] **Step 4: Download Catalog rows.** Under the GUID line: the same platform warning for a platform row, and `linkBackMessage(result, false)` when the result is `other`. The Download buttons are unchanged.

- [ ] **Step 5: Verify** — `npm run build` (expected `✓ built`), `npm run lint` (exit 0), `npm run test` (all pass).

- [ ] **Step 6: Commit** — `git add -A src/components/Editor/PublisherEditor && git commit -m "Show which catalog albums the artist controls"`

---

### Task 6: Document it and check it in a real browser

**Files:**
- Modify: `CLAUDE.md` — a "Publisher catalog: albums the artist controls" subsection under Architecture → Feed Hosting & Podcast Index: the three results and the refusal, the GUID-only link-back rule and why (Longy's shared `4d25f0dd…`), the proxy budget reason for when checks run, the "never overwrite another publisher's claim" rule in `processCatalogFeed`, the mixed-catalog Publish section and the signed-in-owner fallback, and that `CLAUDE.md` itself needs a port to the Desktop fork.

- [ ] **Step 1: Write the CLAUDE.md subsection** (normal prose style, matching the file).

- [ ] **Step 2: Browser check** with the dev server (`npx vite --port 5199`; `/api` proxies to production) and Playwright + system Chrome, as CLAUDE.md's Feed check section describes:
  - Import `https://headstarts.uk/msp/publisher-feeds/longy-everything-publisher-feed.xml` → 11 rows show the Wavlake warning; the Feed check shows one `publisher-item-platform` item ending `and 8 more`; the Publish section is **not** shown (no MSP albums); Save → Download XML still works.
  - Import Strange Love's `https://musicsideproject.com/api/hosted/e3e2e758-6c83-41e3-87f2-d3c64d3011f8.xml` → the three MSP rows report `Points back to this publisher feed.` without pressing anything; the Publish section shows.
  - Search Directory for `Strange Love Wavlake` → the Wavlake results show `Can't add` and the refusal text.
  - Press "Check links back" on Longy's feed → "Into the Valueverse 1" reports the other publisher; "Into the Valueverse - Full Show" reports not linked.
  - At 390 px width, `document.documentElement.scrollWidth === clientWidth`.

- [ ] **Step 3: Final verification** — `npm run build`, `npm run test`, `npm run lint`; quote the summary lines.

- [ ] **Step 4: Commit** — `git commit -am "Document the publisher catalog control rules"`
