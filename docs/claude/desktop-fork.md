# Desktop App fork (MSP-2.0-Desktop-App)

Read this before changing a file the Desktop App forked, adding an `/api` call, bumping a dependency, or working on a sync, port or reconcile PR in `ChadFarrow/MSP-2.0-Desktop-App`.

## How the sync works

- `.github/workflows/notify-desktop.yml` sends a `repository_dispatch` (`web-repo-updated`) on each push to `master`, except pushes that touch only `**.md` or `docs/**`. Secret: `DESKTOP_SYNC_TOKEN`.
- The fork's `sync-upstream.yml` ("Sync from Web Repo") also runs daily at 06:00 UTC and by hand. It merges web `master`, resolves conflicts, deletes `notify-desktop.yml` and `ci.yml`, opens a PR from `sync-upstream` (rebuilt each run: never put a fix there) and enables auto-merge with a merge commit, gated on Lint, Unit Tests, E2E Tests, Dependency Audit and Build. Secret: `SYNC_PAT`.
- Every merge to the fork's `master` runs `release.yml` (Tauri build, GitHub Release, updater `latest.json`); only root-level `*.md`, `example-feed.xml` and `sync-upstream.yml` are path-ignored. `release.yml` has no `concurrency` group: if an older run finishes last, `latest.json` points users back at it. Let one release finish before merging the next fork PR, sync PRs included.

## The `--ours` trap

- The sync resolves every conflicted path to the fork's version (a path the fork deleted stays deleted). A green sync PR does not mean a change reached the fork: for a diverged file it did not. The PR body lists the conflicted files.
- The upstream commit still enters the fork's history, so no later sync offers it again. The content is skipped for good, not queued. Only a port or reconcile PR on the fork gets it in.
- A clean merge can still break the fork: delete an asset and its uses in `App.tsx` here, and the fork gets the deletion but keeps its own `App.tsx` that uses it. Land a matching port PR on the fork's `master`.
- A sync with no PR: read the fork's conflict-resolution step log first.

## Why files fork: `apiFetch`

A packaged desktop build has no same-origin `/api`, so the fork rewrites each `fetch('/api/...')` to `apiFetch()` (`src/utils/api.ts`) and from then on owns its own copy of that file. A new `/api` call in a shared file therefore forks that file. An edit on a line next to the fork's `apiFetch` import conflicts, and the sync keeps the fork's whole file: keep new imports at least one unchanged line away from it.

## Diverged files

Compute the current list (it also shows files of web commits the fork has not merged yet):

```sh
for r in MSP-2.0 MSP-2.0-Desktop-App; do
  gh api "repos/ChadFarrow/$r/git/trees/master?recursive=1" \
    --jq '.tree[]|select(.type=="blob")|"\(.path) \(.sha)"' | sort > "$r.txt"
done
join MSP-2.0.txt MSP-2.0-Desktop-App.txt | awk '$2!=$3{print $1}'
```

Snapshot (Nov 2026):

- Deep forks, assume nothing propagates: `App.tsx`, `App.css`, `Editor.tsx`, `SaveModal.tsx`, `NostrConnectModal.tsx`, `ModalWrapper.tsx`, `feedStore.tsx` and `feedStore.test.ts`, `nostrStore.tsx`, `hostedFeed.ts`, `nostrSigner.ts`, `nostr.ts`, `adminAuth.ts`, `xmlParser.test.ts`, `AdminPage.tsx`, `FeedList.tsx`, `CLAUDE.md`, `package.json`, `package-lock.json`, `vite.config.ts`, `eslint.config.js`; in `api/`: `urlSafety.ts`, `rateLimiter.ts`, `xmlUtils.ts`, `hosted/index.ts`, `proxy-feed.ts`, `admin/*` and most tests.
- `apiFetch` lines only: `xmlParser.ts`, `publisherControl.ts`, `publisherPublish.ts`, `CatalogFeedsSection.tsx`, `DownloadCatalogSection.tsx`, `PublisherFeedReminderSection.tsx`, `ImportModal.tsx`, `PodpingModal.tsx`.
- Fork-only files that no upstream edit reaches: the fork edits tracks in `src/components/Editor/TracksSection.tsx` (value splits, alternate versions, "Recommended first listen"), credits in `CreditsSection.tsx`, the album's publisher in `PublisherLookupSection.tsx`. A change to that part of `Editor.tsx` needs a hand edit there.
- A new file syncs as-is; put new styles in a new CSS file, not `App.css`.

## Porting a change into a diverged file

- The fork PR edits its own copies, and copies each new file the change needs byte-for-byte from web, so the later sync's add/add merge is clean. A differing copy conflicts, and the fork keeps its stale one for good.
- Merge the port after the upstream PR merges, check `git diff <web master> -- <new files>` is empty, then re-run Sync from Web Repo.
- Exception: a dependency bump lands in the fork first. The lockfiles have diverged, so a bump's `package-lock.json` hunks keep the fork's copy while `package.json` merges, and `npm ci` fails in every job of the sync PR.
- Simulate before trusting a port: merge web `master` into the fork branch, `git checkout --ours` each conflicted path, then build and test.
- The fork has jsdom component tests (`src/test/setup.ts` mocks `localStorage`); this repo has none. A port that adds a context hook to a component must wrap it in its provider there (e.g. `ExperimentalProvider` in `TracksSection.test.tsx`).

## Reconcile instead of many ports

- When several upstream changes are stuck behind one red sync, merge web `master` into one fork branch and resolve every conflict by intent: one release, no copies, no ordering. Worked examples: fork PRs #38, #84.
- Merge a reconcile with a merge commit, never a squash, and check the parents after it merges. A squash drops the second parent, so the next sync replays every web commit, and a hunk already ported can apply again at its old position with no conflict, in a green PR that auto-merges.
- Preview a replay, on fork `master` with web as `upstream`: `git merge --no-commit upstream/master`, `git checkout --ours` each conflicted path, `git diff --cached origin/master`.
- Repair a squashed reconcile without changing files: a PR holding `git merge -s ours upstream/master`, merged with `gh pr merge <n> --merge` (fork PR #91). Then `git rev-list master..upstream/master --count` is 0. Close any sync PR built before the repair.

## A red required check holds every sync PR

One red check (often Dependency Audit on a transitive advisory) holds every sync. Fix the check in the fork; an admin merge gets only one sync through. The usual audit fix is `npm update <pkg> --package-lock-only` inside the existing range. When two fixes each need the other to go green, put a byte-identical copy of the upstream change into the fork PR.

## Stacked PRs in this repo

PRs here are squash-merged and their branches deleted, so when a stack's base merges, the child (retargeted to `master`) conflicts with the squash. Prefer one PR, or merge the base with a merge commit. To repair a child without a force-push, confirm the squash's tree equals the base branch applied to the old `master`, then:

```sh
tree=$(git merge-tree --write-tree --merge-base=<old base head> origin/master origin/<child> | head -1)
git commit-tree "$tree" -p origin/<child> -p origin/master -m "Merge master"
```

Test it and push it to the child (a fast-forward). Do not take the child's side of each conflict wholesale when `master` also changed that file.

## Fork menu

The fork shows "Show Experimental Features" in every build, but it does nothing in a release (DEV-gated store); "Show Beta Features" works.
