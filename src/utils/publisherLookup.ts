import { urlKey } from './publisherParties';

// The Podcast Index lookup behind every publisher Feed URL field in the album
// editor: the primary publisher and each other publisher. It is its own module
// because it calls /api, which the Desktop App rewrites to apiFetch(): keeping
// the call here keeps publisherParties.ts and the components free of it.

export interface PublisherFeedMatch {
  feedGuid: string;
  title: string | null;
  image: string | null;
}

export type PublisherLookupResult =
  | { ok: true; feed: PublisherFeedMatch }
  | { ok: false; error: string };

/** The error the editor answers with its "Submit to Podcast Index" button. */
export const PUBLISHER_NOT_FOUND = 'Feed not found in Podcast Index';

interface PiFeed {
  podcastGuid?: string;
  url?: string;
  title?: string;
  image?: string;
}

/**
 * The search result that is the feed at `feedUrl`, or undefined.
 *
 * /api/pisearch looks a URL up exactly only when it contains ".xml", "/feed" or
 * "rss" (isFeedUrl in api/pisearch.ts); any other URL goes to a full-text
 * search, whose first result is just some feed. So a result is taken when its
 * URL is the one asked for, or when it is the single answer of an exact lookup
 * (Podcast Index may store the address the feed redirected to).
 */
export function pickFeedForUrl(feeds: PiFeed[], feedUrl: string): PiFeed | undefined {
  const wanted = urlKey(feedUrl);
  const match = feeds.find(feed => urlKey(feed.url) === wanted);
  if (match) return match;
  const exactLookup = /\.xml|\/feed|rss/.test(feedUrl);
  return exactLookup && feeds.length === 1 ? feeds[0] : undefined;
}

/** Look up the publisher feed at `feedUrl` in Podcast Index. Never throws. */
export async function lookupPublisherFeed(feedUrl: string, signal?: AbortSignal): Promise<PublisherLookupResult> {
  try {
    const response = await fetch(`/api/pisearch?q=${encodeURIComponent(feedUrl)}`, { signal });
    const data = await response.json();
    if (!response.ok) return { ok: false, error: data.error || 'Feed not found' };

    const feed = pickFeedForUrl(Array.isArray(data.feeds) ? data.feeds : [], feedUrl);
    if (!feed?.podcastGuid) return { ok: false, error: PUBLISHER_NOT_FOUND };
    return { ok: true, feed: { feedGuid: feed.podcastGuid, title: feed.title || null, image: feed.image || null } };
  } catch {
    return { ok: false, error: 'Failed to lookup feed' };
  }
}
