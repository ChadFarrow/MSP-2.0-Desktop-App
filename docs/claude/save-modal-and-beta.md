# Save destinations, experimental and beta features

Read this before adding or changing a Save destination or Import source, or anything gated on `showExperimental` or `showBeta`.

## Destinations (`src/components/modals/SaveModal.tsx`)

| Destination | Publishes | Where | Subscribable |
|---|---|---|---|
| Local Storage | editor state | browser localStorage | no |
| Download XML, Copy to Clipboard | RSS XML | file, clipboard | no |
| Host on MSP | RSS XML | Vercel Blob `feeds/{feedId}.xml` | yes: `https://musicsideproject.com/api/hosted/{feedId}.xml` |
| Submit to PodcastIndex | a feed URL, via `/api/pubnotify` | - | through PI discovery |
| Publish to Nostr Music | kind 36787 per track + kind 34139 playlist | music relays | no: Nostr-native players (e.g. Sunami) only; Wavlake and Fountain do not play them. Audio must already be hosted. |
| Save RSS feed to Nostr (exp.) | RSS XML in kind 30054 | relays | no: only MSP reads it |
| Publish RSS feed to a Blossom server (exp.) | RSS XML + kind 1063 pointer | Blossom + relays | yes: `${origin}/api/feed/{npub}/{podcastGuid}.xml` redirects to the latest upload |
| Publish RSS feed to nsite (exp.) | RSS XML + NIP-5A manifest (kind 35128) | Blossom + relays | yes, via an nsite gateway; the gateway URL is then sent to `/api/pubnotify` |

- `isDestinationVisible()`: Nostr Music needs a Nostr login and is hidden in publisher mode; the three experimental ones need a login and `showExperimental`.
- `SAVE_DESTINATIONS` (`{ value, label, blurb, experimental? }`) is the single source for the dropdown; `experimental: true` appends the ` 🧪` marker at render. Add a destination there, never as a hand-written option.
- The help popup (`showHelp`) is a hand-written list; keep it in step with `SAVE_DESTINATIONS`.
- Podping has its own toolbar button (`PodpingModal.tsx`); it is not a Save destination.
- The picker is a custom dropdown (a native `<option>` holds one line of plain text). Its menu is portaled to `document.body` with `position: fixed` (`openDestMenu()`) to escape the modal's `overflow`, at `z-index: 1100` above `.modal-overlay` (1000), flips up when there is more room, and caps at 340px. The capture-phase scroll-to-close listener ignores scrolls inside the menu, or scrolling the list would close it. Styles: `.save-dest*` in `App.css`.

## Experimental: local dev only

- `showExperimental` (`useExperimental()`, `src/store/experimentalStore.tsx`, localStorage `msp-show-experimental`) is effectively `import.meta.env.DEV && stored`, so nothing behind it reaches production or a desktop release. The Nostr, Blossom and nsite destinations and the "Nostr Event" and "From Nostr" imports stay there on purpose.
- A new experimental destination or import source: gate it on `showExperimental`, mark it ` 🧪`, put it last in its dropdown and help list, and extend the mode-reset `useEffect` (SaveModal and ImportModal each have one) so the selection falls back to a safe default when the toggle goes off.
- `eslint.config.js` turns off `react-refresh/only-export-components` for `src/store/*.{ts,tsx}` (Provider and `useX()` share a file).

## Beta: the production opt-in

- Editor features that users should try go behind `showBeta` (same store, localStorage `msp-show-beta`, default off, not DEV-gated), toggled by "Show Beta Features" in the hamburger menu.
- The beta features are the `BETA_FEATURES` array in `src/components/BetaBanner.tsx`: "This publisher is", "Other publishers", "Alternate Versions", "Recommended first listen". A new `showBeta` gate needs an entry there, with `name` equal to the field label, or the banner under the header lists less than is switched on.
- A beta field puts `<BetaTag />` in its label and the `beta-field` class on its wrapper (`src/components/BetaTag.tsx`, `BetaTag.css`). The highlight shows wherever the field shows, beta off included.
- With beta off, hide the way to add one, never data the feed already has: the generator still writes it and the Feed check still reports it, so hiding it leaves a reported problem with no field to fix it in. Pattern: render on `showBeta || <feed has it>`, and pass `canAdd={showBeta}`.
- Layout traps:
  - The tag background is `#7c3aed`, not `--accent-primary`: white on `#8b5cf6` fails WCAG AA at that size.
  - The tag never breaks, so `.beta-field .form-label` wraps; on one line, a long label widened every field of a track past its card on a 320px phone.
  - At 480px and below the box keeps to the field's width instead of overhanging the card.
  - At 768px and below the banner shows names only: it sits outside the scrolling `.editor-panel`, so each line costs screen for the whole session.

## Desktop App fork

`App.css` and `App.tsx` are forked (see `desktop-fork.md`). So beta styles live in `BetaTag.css` and `BetaBanner.css`, because a new file syncs as-is, and the `<BetaBanner />` mount (web: in `App.tsx` between `</header>` and the editor) is a hand edit in the fork's `App.tsx` (before `<div className="app-body">`). The fork edits tracks in its own `TracksSection.tsx`, so a new beta field on a track, or a change to the banner mount, needs a hand edit there too.
