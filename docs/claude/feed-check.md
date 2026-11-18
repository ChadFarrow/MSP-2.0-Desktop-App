# Feed check

Read this before you change the Feed check panel, a Save gate rule, the import error message or the link check.

The Feed check tells a user, after an import, what to fix. It is advisory and never blocks an import. `checkFeed()` (`src/utils/feedChecks.ts`) builds three groups: Must fix, Should fix, Updated by MSP when you save.

## Rules
- **One rule list for the panel and the Save gate.** `getSaveBlockers(feed, target)` is what `SaveModal.handleSave` refuses on (through `formatSaveBlockers`, "Missing required fields: …") and what the Must group shows. `feedChecks.test.ts` pins a verbatim copy of SaveModal's old inline gate and asserts parity. Add a Save rule there, never inline in SaveModal.
- `SaveTarget` is `publish` / `nostrMusic` / `hostedCreate`; `nostrMusic ⊆ publish ⊆ hostedCreate` is tested. The panel shows `hostedCreate`, so it never calls a feed clean that some destination refuses.
- `hostedCreate` adds the UUID rule: a new hosted feed's id is its `podcastGuid`, and the server requires a UUID (`isValidFeedId`). `isUuidGuid` mirrors that regex and, like the server, does not trim. Updates to an existing hosted feed use `publish`.
- `getShouldFixIssues` holds live rules for what passes Save but breaks in apps or validators (zero duration, duplicate GUIDs, bad URLs, empty Website, …). Rules on a field Save requires fire only when it is non-empty, so nothing repeats a Must item. Never flag a harmless extra: a feed with no value block is valid.
- `inspectFeedXml(xml)` (`src/utils/feedInspect.ts`) reads the **source** XML, because some findings vanish once parsed (two `<podcast:value>` blocks, a missing `<image><link>`, a legacy explicit word). It reports what MSP changes or cannot keep and what breaks the feed, never an element only because MSP doesn't model it (a test expects `[]` for a feed full of harmless extras). Each claim a message makes about MSP's behaviour has a paired test against the real parser/generator, so a parser fix forces the message to change. It never throws, and uses `createFeedXmlParser()` so it sees the importer's tree.
- Item findings carry `itemIndex`; `bindSourceFindings` turns it into a `trackId` right after the import, so a reorder never misplaces it. `openSourceFindings` drops a finding whose track is gone, and drops `value-blocks-multiple` / `transcripts-multiple` once the user re-enters the splits / lyrics URL.

## Import errors
`handleImport` (`App.tsx`) throws `describeImportError(xml, err)`, never `alert()`s; callers show it inline and keep the pasted XML. The message names a missing `<rss><channel>` first, else gives `XMLValidator`'s line and column. fast-xml-parser is lenient: a mismatched closing tag or an unescaped `&` still imports and gets an `xml-malformed` item; only structural breakage throws.

## Panel and state
- `src/components/FeedCheckPanel.tsx` is the first child of `.editor-panel` in `Editor.tsx` and `PublisherEditor/index.tsx`, inside the scroll container. `handleImport` dispatches `OPEN_FEED_CHECK { sourceFindings: inspectFeedXml(xml) }` right after each `SET_*`; Nostr loads open it with no findings. Closed, it is a "Check feed" button. Groups are recomputed from the current feed on every render.
- State lives in `FeedState.feedCheck`, not in the Editor, because the Editor is keyed on `podcastGuid` and remounts on each keystroke in the GUID field. Whole-feed swaps (`SET_*`, `CREATE_NEW_*`, `RESET`) reset it but keep `runSeq`, except a `SET_PUBLISHER_FEED` with the GUID already loaded (`PublishSection` re-dispatching after a publish). Not persisted.

## Link check
- `collectLinkTargets` (one target per URL, with every role and track using it), `runLinkCheck` (pool of `LINK_CHECK_CONCURRENCY`, 4; after abort no probe starts and no result is reported) and `summarizeLinks` are pure and tested in `src/utils/linkCheck.ts`. Browser probes: `src/utils/mediaProbe.ts`.
- The runner is a `useEffect` on `feedCheck.linkRun` in `FeedProvider`, which never remounts. Its cleanup aborts, and `LINK_CHECK_RESULT` is dropped unless its `runId` matches, so one feed's result never lands on the next. Results are keyed by URL; an edited URL shows unchecked until "Check links again".
- Probes load through `<audio>`/`<video>`/`<img>`, not `fetch`, because media elements are not subject to CORS. A probe must tell broken (error) from slow (timeout, `unknown`).
- An `http://` URL on the https app is not probed (`unknown: 'http'`: mixed content says nothing about apps); the `url-http` rule reports it. A type the browser can't decode is `unknown: 'format'`, never broken. Images load with `referrerPolicy = 'no-referrer'`, as podcast apps send no Referer.
- Cover and track art must be square and `ARTWORK_MIN_PX`–`ARTWORK_MAX_PX` (1400–3000 px). Extra `<podcast:image>`s get the reachability check only.
- One run checks at most `LINK_CHECK_LIMIT` (100) links, the cover first and then tracks in order (`startLinkRun` in `feedStore.tsx`), and the panel says so.
