function hasNonAscii(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    if (url.charCodeAt(i) > 127) return true;
  }
  return false;
}

const CHECKS: Array<{ test: (url: string) => boolean; label: string; detail: string }> = [
  {
    test: (url) => url.includes(' '),
    label: 'spaces',
    detail: 'Spaces are not valid in URLs and will cause submission errors.',
  },
  {
    test: (url) => url.includes("'"),
    label: "apostrophes (')",
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

export function getFeedUrlError(url: string): string | null {
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
