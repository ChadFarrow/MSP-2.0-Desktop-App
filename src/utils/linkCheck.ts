// Which links a feed has, and how to check them a few at a time.
//
// Pure: the probing itself is injected (mediaProbe.ts in the browser, a fake
// in tests), so the pool and the bookkeeping are unit-tested in node.
import type { FeedSnapshot } from './feedChecks';
import type { PodcastImage } from '../types/feed';
import { isVideoUrl } from './videoUtils';

export type LinkKind = 'audio' | 'video' | 'image';
export type LinkRole = 'enclosure' | 'artwork' | 'trackArt' | 'extraImage';

/** One URL to check, with everything in the feed that uses it. */
export interface LinkTarget {
  url: string;
  kind: LinkKind;
  roles: LinkRole[];
  trackIds: string[];
  /** The enclosure type the feed states — lets the probe skip a format this browser can't decode. */
  mimeType?: string;
}

export type LinkResult =
  | { status: 'ok'; width?: number; height?: number; durationSeconds?: number }
  | { status: 'broken' }
  // 'http': not probed — an http:// URL on the https app is mixed content, so a
  // failure would say nothing about podcast apps. 'format': this browser can't
  // decode the type, though podcast apps may.
  | { status: 'unknown'; reason: 'timeout' | 'http' | 'format' };

export type LinkProbe = (target: LinkTarget, signal: AbortSignal) => Promise<LinkResult>;

export const LINK_CHECK_CONCURRENCY = 4;

/**
 * A music album has a few dozen links; a long-running podcast imported by mistake
 * can have ten thousand, and loading every enclosure's metadata would pull
 * gigabytes and re-render the editor once per result. The run takes the first
 * this many — the cover, then tracks in order — and the panel says so.
 */
export const LINK_CHECK_LIMIT = 100;

/**
 * Every http(s) link in the feed, one entry per URL. Empty and non-web URLs are
 * left to the live rules, which report them without a network request.
 */
export function collectLinkTargets(feed: FeedSnapshot): LinkTarget[] {
  const byUrl = new Map<string, LinkTarget>();
  const add = (rawUrl: string | undefined, kind: LinkKind, role: LinkRole, trackId?: string, mimeType?: string) => {
    const url = rawUrl?.trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    const existing = byUrl.get(url);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      if (trackId && !existing.trackIds.includes(trackId)) existing.trackIds.push(trackId);
      return;
    }
    byUrl.set(url, { url, kind, roles: [role], trackIds: trackId ? [trackId] : [], ...(mimeType ? { mimeType } : {}) });
  };
  const addImages = (images: PodcastImage[] | undefined, trackId?: string) =>
    (images ?? []).forEach(image => add(image.href, 'image', 'extraImage', trackId));

  if (feed.feedType === 'publisher' && feed.publisherFeed) {
    add(feed.publisherFeed.imageUrl, 'image', 'artwork');
    addImages(feed.publisherFeed.podcastImages);
    return [...byUrl.values()];
  }

  const { album } = feed;
  add(album.imageUrl, 'image', 'artwork');
  addImages(album.podcastImages);
  for (const track of album.tracks) {
    const isVideo = track.enclosureType?.startsWith('video/')
      || (feed.feedType === 'video' && !track.enclosureType?.startsWith('audio/'))
      || isVideoUrl(track.enclosureUrl ?? '');
    add(track.enclosureUrl, isVideo ? 'video' : 'audio', 'enclosure', track.id, track.enclosureType || undefined);
    add(track.trackArtUrl, 'image', 'trackArt', track.id);
    addImages(track.podcastImages, track.id);
  }
  return [...byUrl.values()];
}

/**
 * Probe every target, at most `concurrency` at once. Once `signal` aborts no new
 * probe starts and no result is reported — a result for the previous feed must
 * never land on the next one.
 */
export async function runLinkCheck(
  targets: LinkTarget[],
  options: { probe: LinkProbe; signal: AbortSignal; onResult: (url: string, result: LinkResult) => void; concurrency?: number }
): Promise<void> {
  const { probe, signal, onResult, concurrency = LINK_CHECK_CONCURRENCY } = options;
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < targets.length) {
      const target = targets[next++];
      let result: LinkResult;
      try {
        result = await probe(target, signal);
      } catch {
        result = { status: 'unknown', reason: 'timeout' };
      }
      if (signal.aborted) return;
      onResult(target.url, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
}

export interface LinkSummary {
  total: number;
  checked: number;
  broken: number;
  /** http:// links, deliberately not probed. */
  httpSkipped: number;
  /** The feed has more links than one run checks (LINK_CHECK_LIMIT). */
  limited: boolean;
}

/** Progress over the feed's CURRENT links, so an edited URL counts as unchecked. */
export function summarizeLinks(targets: LinkTarget[], links: Record<string, LinkResult>): LinkSummary {
  const summary: LinkSummary = {
    total: targets.length, checked: 0, broken: 0, httpSkipped: 0, limited: targets.length > LINK_CHECK_LIMIT
  };
  for (const target of targets) {
    const result = links[target.url];
    if (!result) continue;
    summary.checked++;
    if (result.status === 'broken') summary.broken++;
    if (result.status === 'unknown' && result.reason === 'http') summary.httpSkipped++;
  }
  return summary;
}
