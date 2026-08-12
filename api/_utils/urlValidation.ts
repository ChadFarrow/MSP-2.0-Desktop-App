// Mirror of src/utils/urlValidation.ts — Vercel functions cannot import from src/.
// Keep the rule table in sync with the frontend version; a diff catches drift.

// Zero-width and BOM characters that survive a copy out of a web page, email or
// PDF. Invisible in the input box, so they have to be stripped rather than
// reported — the user has no way to see or delete them.
const INVISIBLE_CODES = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

/** True for a character that is paste junk rather than part of the URL. */
function isEdgeJunk(char: string): boolean {
  const code = char.charCodeAt(0);
  // C0 controls are exactly what the WHATWG URL parser strips, so trimming them
  // here keeps new URL() and this function from ever disagreeing about a URL.
  if (code <= 0x1f || code === 0x7f) return true;
  if (INVISIBLE_CODES.has(code)) return true;
  // Spaces, tabs, newlines, NBSP and the Unicode space separators.
  return /\s/.test(char);
}

/**
 * Trims paste artifacts from the ends of a feed URL.
 *
 * Interior whitespace is preserved on purpose: removing it would submit a
 * *different* URL than the one the user has, and percent-encoding it would be a
 * guess about what the file at the host is actually called. getFeedUrlError
 * rejects it instead, and tells the user to rename the file at the host.
 *
 * Idempotent.
 */
export function normalizeFeedUrl(url: string): string {
  let start = 0;
  let end = url.length;
  while (start < end && isEdgeJunk(url[start])) start++;
  while (end > start && isEdgeJunk(url[end - 1])) end--;
  return url.slice(start, end);
}

function hasNonAscii(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    if (url.charCodeAt(i) > 127) return true;
  }
  return false;
}

const CHECKS: Array<{ test: (url: string) => boolean; label: string; detail: string }> = [
  {
    // Runs on the already-normalized URL, so anything this matches is *interior*
    // whitespace. Tabs and newlines matter as much as spaces: new URL() deletes
    // them silently, so an unchecked one means Podcast Index gets a URL the user
    // never typed.
    test: (url) => /\s/.test(url),
    label: 'whitespace (spaces, tabs, or line breaks)',
    detail:
      'Spaces, tabs and line breaks are not valid in URLs. Rename the file at your host to remove them, then submit the new URL.',
  },
  {
    // Every apostrophe-shaped character, not just the ASCII U+0027. A filename
    // copied out of a word processor or a smart-quoting CMS carries U+2019, and
    // U+2018 is what those same tools produce for a *leading* elision — 'Round
    // Midnight, 'Til Dawn. U+02BC and U+02BB are letters in Uzbek, Cherokee and
    // Hawaiian orthography (Hawaiʻi); U+FF07 comes out of a CJK IME.
    //
    // None of these changes whether a URL is refused: they are all non-ASCII, so
    // the last rule already caught them. What changes is *which* message the user
    // reads — this rule comes first, so they now get the duplicate-feed
    // explanation instead of the generic "may cause indexing issues".
    //
    // A pre-encoded %27 is deliberately NOT matched. It is the form Podcast Index
    // itself stores and hands back, it is a correctly encoded URL that fetches
    // fine, and this rule table is a hard 400 on /api/pisubmit, /api/pubnotify,
    // /api/podping, /api/podping-verify and /api/verify-feed-url — so matching it
    // would refuse working feeds outright and leave the user unable to even run a
    // reachability check. Warn about the character the user can still fix by
    // renaming; don't block the URL that already works.
    test: (url) => /['’‘ʼʻ＇]/.test(url),
    label: "apostrophes (' or ’)",
    detail:
      "Podcast Index may encode apostrophes as %27, creating a duplicate feed entry. Rename the file to remove them.",
  },
  {
    test: (url) => /[<>"{}|\\^`]/.test(url),
    label: 'special characters (<, >, ", {, }, |, \\, ^, `)',
    detail: 'These characters require percent-encoding and may cause indexing issues.',
  },
  {
    test: hasNonAscii,
    label: 'non-ASCII characters',
    detail: 'Non-ASCII characters require percent-encoding and may cause indexing issues.',
  },
];

export function getFeedUrlError(rawUrl: string): string | null {
  // Normalize here rather than only at the call sites: a caller that forgets can
  // then never produce a false "contains whitespace" error for a pasted URL.
  const url = normalizeFeedUrl(rawUrl);
  if (!url) return null;

  const found: string[] = [];
  let detail = '';

  for (const { test, label, detail: d } of CHECKS) {
    if (test(url)) {
      found.push(label);
      if (!detail) detail = d;
    }
  }

  if (found.length === 0) return null;

  return `URL contains ${found.join(', ')}. ${detail} Please fix the URL before submitting to Podcast Index.`;
}
