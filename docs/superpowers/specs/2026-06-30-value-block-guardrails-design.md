# Value Block Guardrails — Design

**Date:** 2026-06-30
**Branch:** `feature/value-block-guardrails`

## Context

Two related improvements to the Value Block (Lightning) editing experience:

1. **Empty-split validation (the important one).** A user recently published a feed with a value recipient whose split % was left empty. Podcasting 2.0 splits are *proportional*, so an empty (→ 0) split means that recipient receives nothing and the remaining splits — the auto-added MSP 2.0 + Podcast Index community-support recipients — absorb 100% of the sats. The artist got nothing. MSP must not submit an incomplete feed to Podcast Index.

2. **"Add my Lightning wallet (from Nostr)" button.** A Nostr-logged-in user's kind-0 profile already carries their lightning address (`lud16`). A one-click button in the Value Block should pull it in as a recipient so they don't have to retype it.

## Scope decision

The empty-split check hooks into the **existing `requiresValidation` gate** in `SaveModal.tsx` — the same gate the current "Missing required fields" errors use. This is deliberate: MSP only guarantees completeness for feeds it **generates and submits to Podcast Index**. If a user downloads an unfinished feed and self-hosts it, that is their responsibility, matching the existing behavior.

- **Blocks on empty split:** the full existing `requiresValidation` set — Host on MSP, Publish to Nostr Music, Save RSS feed to Nostr (kind 30054), Blossom, nsite. (Save-to-Nostr doesn't hit PI, but it already runs the required-fields validation, so including it keeps behavior consistent and avoids saving a broken value block anywhere.)
- **Exempt (unchanged):** Save to Local Storage, Download XML, Copy to Clipboard, Submit to PodcastIndex (URL-only — the bytes live elsewhere).

## Feature 1 — Empty-split validation

### Rule
Every value recipient that is present in a value block must have `split > 0`. Empty/`0`/negative is invalid. Community-support recipients already carry `split: 1`, so they always pass.

### Coverage (every value block)
- Album/video feed level: `album.value.recipients`
- Per track: `track.value.recipients` (each track)
- Publisher: `publisherFeed.value.recipients`

### Implementation
- New pure helper `getValueRecipientErrors(recipients, label)` in `src/utils/valueValidation.ts`: returns an array of human-readable error strings for any recipient with `split <= 0` (or non-finite). Label is a prefix like `"Value recipient"` or `"Track 2 value recipient"`.
- In `SaveModal.tsx`, inside the existing `if (requiresValidation) { ... }` block, call the helper for the album/publisher feed-level recipients and (for album/video) each track's recipients, pushing any errors into the same `errors` array that already produces the `"Missing required fields: ..."` message. No new save-blocking path is introduced.
- Error text names the offender, e.g. `Value recipient "Alice" — split % is required` / `Track 2 value recipient "Alice" — split % is required`. A recipient with no name falls back to its address, then to its index.

### Tests
`src/utils/valueValidation.test.ts` (Vitest): empty split flagged, `0` flagged, negative flagged, valid `>0` passes, community-support (`split:1`) passes, label prefix + name/address/index fallbacks in the message, multiple offenders each reported.

## Feature 2 — "Add my Lightning wallet (from Nostr)" button

### Data plumbing
- Extend `NostrProfile` (`src/utils/nostrSync.ts`) with `lud16?: string` and `lud06?: string`. `fetchNostrProfile` already `JSON.parse`s the full kind-0 content, so these fields simply surface data already fetched.
- Extend `NostrUser` (`src/types/nostr.ts`) with `lud16?: string`, and populate it from `profile.lud16` in the `UPDATE_PROFILE` dispatch in `src/store/nostrStore.tsx` (both the login and the restore-session refresh paths). This caches the address so the button is instant and can be shown conditionally with no extra relay round-trip.

### UI (`src/components/RecipientsList.tsx`)
- `RecipientsList` gains access to Nostr state via `useNostr()`.
- **Inline autofill, not a row-adder.** Each non-support recipient row shows a small **"⚡ Use my Lightning wallet"** link under its Address input, shown only when `nostrState.isLoggedIn && nostrState.user?.lud16` **and** that row's address isn't already the wallet. It's positioned by the address field because it's purely a shortcut for *entering the address* — avoiding typos that would silently misroute sats.
- On click, `onUpdate` that row with:
  - `address`: `user.lud16`
  - `type`: `detectAddressType(lud16)` (an `@` → `'lnaddress'`)
  - `name`: keeps the row's name, or fills `user.displayName` if blank
- **Deliberately does not set the split.** The user chooses their own split; a fixed value (e.g. "remaining" = 100 on an empty block) would be a surprising guess. If they leave it blank, the empty-split guardrail (Feature 1) catches it before a PI submission.

### Scope limits (intentional)
- **`lud16` only.** A raw `lud06` (LNURL) is not a valid Podcasting 2.0 value-recipient address, so a profile with only `lud06` shows no button. Can revisit later.
- No relay re-fetch on click — uses the login-time cached `lud16`.

## Out of scope
- Splits summing to exactly 100 (Podcasting 2.0 splits are proportional; not required).
- Inline per-field error styling in the editor (the save-time block is sufficient for the reported problem; can add later).
- Resolving `lud06`/LNURL into an address.

## Verification
- `npm run test` — the new `valueValidation.test.ts` passes.
- `npm run build` (tsc -b + vite) — the authoritative typecheck per CLAUDE.md.
- Manual: (a) leave a recipient's split empty → Host on MSP is blocked with a clear error; Download XML still works. (b) Log in with a Nostr profile that has a `lud16` → the inline "⚡ Use my Lightning wallet" link appears under a row's Address field, fills the address (and name if blank) on click without touching the split, and disappears once that row holds the wallet.
