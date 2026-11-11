# Feed corpus

Real published feeds that `src/utils/feedCorpus.roundTrip.test.ts` imports and saves
the way the app does, to pin what MSP keeps, changes and drops.

- `manifest.json` lists each file with its source URL, the time it was fetched, its
  size and its SHA-256. The test refuses a file whose bytes do not match.
- Only `tools/fetch-feed-corpus.mjs` writes these files. Do not edit one by hand, and
  do not trim a feed that breaks MSP — fix MSP.
- Refresh: `node tools/fetch-feed-corpus.mjs` (or name files to refresh only those),
  then `npx vitest run src/utils/feedCorpus.roundTrip.test.ts -u` and read the
  snapshot diff before committing it.
- Add a feed: `node tools/fetch-feed-corpus.mjs --add <file>.xml <kind> <url>`.

## Where the list came from

The URLs come from the round-trip corpus of
[musicindex-studio](https://github.com/InTheMorning/musicindex-studio)
(`crates/core/tests/corpus/manifest.json`, 2026-10-22). Only the URLs were taken:
every file here was fetched from its own publisher on 2026-11-10. Studio is AGPL-3.0
and this repo is MIT, so do not copy files from it.

Left out of Studio's list:

- `rssblue-publisher-stereon.xml` and `rssblue-musicl-deck-darlings.xml` — RSS Blue
  closed; one host no longer resolves and the other answers with an HTML page.
- The two DeMu template files — the `de-mu/demu-feed-template` repository has no
  license.
- `msp-fixture-example-feed.xml` — it is this repo's own `example-feed.xml`, which the
  test reads from the repo root.

`namespace-fixture-example.xml` is the podcast-namespace repository's `example.xml`
(CC0-1.0), pinned to commit `d4036dc`. It is not a published feed.
