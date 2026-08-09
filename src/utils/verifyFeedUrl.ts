/**
 * Pre-flight a feed URL against its host before submitting it to Podcast Index.
 *
 * Cleaning a pasted URL makes it *plausible*, not *correct* — if the file is
 * really called "my feed.xml", trimming (or the user deleting the space to get
 * past the validator) produces a URL that 404s. A broken URL registered in
 * Podcast Index is worse than a rejected one, because PI keeps the entry.
 *
 * Deliberately advisory: the caller warns and offers "Submit anyway" rather than
 * blocking, because reachability is a heuristic — a slow origin, a Cloudflare
 * challenge, or a host that dislikes our user-agent are all false negatives.
 */

interface VerifyResponse {
  reachable?: boolean;
  status?: number;
  looksLikeFeed?: boolean;
  finalUrl?: string;
  reason?: string;
  error?: string;
}

export interface VerifyFeedUrlResult {
  /** False only when we have positive evidence something is wrong. */
  ok: boolean;
  /** User-facing sentence, present exactly when ok is false. */
  warning: string | null;
}

const OK: VerifyFeedUrlResult = { ok: true, warning: null };

function describeStatus(status: number): string {
  if (status === 404) return "That URL didn't load — the host returned 404 Not Found.";
  if (status === 403) return "That URL didn't load — the host refused the request (403).";
  if (status === 401) return 'That URL needs a login, so podcast apps will not be able to read it.';
  if (status >= 500) return `That URL didn't load — the host returned a ${status} error.`;
  return `That URL didn't load — the host returned HTTP ${status}.`;
}

export async function verifyFeedUrl(url: string): Promise<VerifyFeedUrlResult> {
  let response: Response;
  try {
    response = await fetch(`/api/verify-feed-url?url=${encodeURIComponent(url)}`);
  } catch {
    // Our own check failed, which says nothing about the user's URL.
    return OK;
  }

  // 403 means MSP refused the address (private/loopback) — that IS a verdict.
  if (response.status === 403) {
    return { ok: false, warning: 'That address is not one MSP can fetch. Use a public URL.' };
  }

  // Anything else non-200 (rate limit, unconfigured, our bug) is our problem.
  if (!response.ok) {
    return OK;
  }

  let data: VerifyResponse;
  try {
    data = await response.json();
  } catch {
    return OK;
  }

  if (data.reachable === false) {
    const detail = typeof data.status === 'number' ? describeStatus(data.status) : null;
    return {
      ok: false,
      warning: detail
        ?? (data.reason
          ? `That URL didn't load — ${data.reason.charAt(0).toLowerCase()}${data.reason.slice(1)}.`
          : "That URL didn't load. Check the feed is published at that address.")
    };
  }

  if (data.reachable === true && data.looksLikeFeed === false) {
    return {
      ok: false,
      warning: "That URL loaded, but it doesn't look like an RSS feed. Check you copied the feed URL rather than a web page."
    };
  }

  return OK;
}
