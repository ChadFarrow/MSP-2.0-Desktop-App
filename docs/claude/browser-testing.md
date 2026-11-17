# Browser testing

Read before you test a UI change. This repo has no DOM tests (Vitest runs in node), so a component's wiring — refs, paste handlers, a lookup that lands after a collapse — is only proven by driving the dev server in a real browser.

## Server

- `npx vite --port 5173 --strictPort` (any free port). Stop it with `lsof -ti:5173 -sTCP:LISTEN | xargs kill`.
- **`/api` proxies to production** (`vite.config.ts`). Never drive anything that writes: Host on MSP, Submit to PodcastIndex and Podping go through it to the live services, and Nostr publishing reaches live relays without it. Import, edit and View Feed are safe.

## Driver

Either works with the installed Chrome:

- **Playwright** is not a dependency here. On the Mac mini, import it from the Desktop App checkout (`~/Vibe/MSP-2.0-Desktop-App/node_modules/playwright/index.mjs`, after `npm ci` there if `node_modules` is gone) and launch `chromium.launch({ channel: 'chrome', headless: true })`; the cached Playwright Chromium is older than that Playwright wants.
- **Raw CDP** needs nothing installed: start headless Chrome with `--remote-debugging-port=<port>`, open a target with `PUT /json/new`, and talk to its `webSocketDebuggerUrl` with Node's global `WebSocket` (`Runtime.evaluate` with `awaitPromise` and `returnByValue`). Return plain values from `evaluate`, never a DOM node.
- Follow the global rules for headless Chrome (session profile dir, `--disable-features=MacAppCodeSignClone`, quit with `Browser.close`, delete the profile).
- Keep test scripts in a scratch directory: `scripts/` is gitignored and `tools/` is for committed tooling.

## Handles

- Import: `button[title="Import"]` → the `.modal select` set to `paste` → `.modal textarea` → the "Import Feed" button. Template import: `button[title^="New"]` → "Use Template" → the same modal and button (only its title changes).
- Generated XML: `button[title="View Feed"]` opens a modal; the XML is in its `pre`.
- Track rows: `.track-list > .repeatable-item`; a click on a row's header toggles its collapse.
- Feed check panel: `.feed-check`; the "Updated by MSP when you save" group is folded behind `.feed-check-toggle`.
- React-controlled inputs: set `value` through the prototype's native setter, then dispatch `input` (or `change` for a `select`).
- Paste handlers read `e.clipboardData`, which Playwright's `fill()` never fires. Dispatch `new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })` with a `DataTransfer` holding `text/plain`.
- `confirm()` dialogs (non-music medium, unsaved changes): accept them via `Page.javascriptDialogOpening` → `Page.handleJavaScriptDialog`, or Playwright's `page.on('dialog')`.

## Techniques

- **Late lookups:** to prove a slow size/height lookup lands after a collapse or reorder, serve the file from a local node server that answers `HEAD` after a delay with `Access-Control-Allow-Origin: *`. For a real CORS-open video, MDN's `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4` works; a host without CORS leaves File Size empty while Height still fills in.
- Count requests (`page.on('request')` or CDP `Network`) when the point is that something is *not* fetched.
- **Phone layout:** use CDP `Emulation.setDeviceMetricsOverride` with `mobile: true`, never `--window-size` (a cropped screenshot looks like overflow that isn't there). Measure `document.documentElement.scrollWidth` against `clientWidth`, and check touch targets against WCAG 2.5.8 (24×24 CSS px). The `.info-icon-wrapper` overhang a layout check reports at ≤768 px is its invisible 12 px touch padding, not overflow.
- Look at the screenshot as well as the numbers.
- In the PR body, list what you verified in the browser and what you did not, with the reason for each gap.
