import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublisherFeed, RemoteItem } from '../../../types/feed';
import { checkAlbumLinkBack, getPlatformHost, isMspHosted, type LinkBackResult } from '../../../utils/publisherControl';

export type LinkBackEntry = LinkBackResult | 'checking';

export interface LinkBackState {
  statusFor(item: RemoteItem): LinkBackEntry | undefined;
  checkItems(items: RemoteItem[]): Promise<void>;
  checkAll(): Promise<void>;
  /** Record albums a publish just linked (from its results; see linkedAfterPublish). */
  markLinked(items: RemoteItem[]): void;
  checkingAll: boolean;
}

// Self-hosted checks go through /api/proxy-feed (60 an hour per IP), so a few at once.
const MAX_CONCURRENT = 3;

const keyFor = (guid: string, item: RemoteItem) => `${guid}|${item.feedUrl ?? ''}`;

/**
 * Which rows to fetch: never a platform row, a row with no URL, or a duplicate.
 * The automatic check also leaves alone a row already known to be linked — a
 * publish marks the albums it linked, and re-reading one straight away can still
 * return the pre-publish XML from the blob CDN.
 */
export function selectItemsToCheck(
  items: RemoteItem[],
  guid: string,
  results: Record<string, LinkBackEntry>,
  skipLinked: boolean
): RemoteItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.feedUrl || getPlatformHost(item.feedUrl)) return false;
    const key = keyFor(guid, item);
    if (seen.has(key)) return false;
    seen.add(key);
    const known = results[key];
    return !(skipLinked && known && known !== 'checking' && known.status === 'linked');
  });
}

/**
 * Whether each catalog album points back, for this session only.
 *
 * Results are keyed by publisher GUID + album URL, so a different publisher feed
 * never shows another's results and nothing needs clearing on import. Only MSP
 * albums are checked automatically — on open, after an import, and after a
 * publish (each bumps feedInstance) — because they're read same-origin and cost
 * no proxy requests. A self-hosted album is checked when it's added, or when the
 * artist asks with "Check links back".
 */
export function useLinkBackStatus(publisherFeed: PublisherFeed | null, feedInstance: number): LinkBackState {
  const [results, setResultsState] = useState<Record<string, LinkBackEntry>>({});
  // Mirrored synchronously, so a check started right after markLinked sees the mark.
  const resultsRef = useRef(results);
  const setResults = useCallback((update: (prev: Record<string, LinkBackEntry>) => Record<string, LinkBackEntry>) => {
    resultsRef.current = update(resultsRef.current);
    setResultsState(resultsRef.current);
  }, []);
  const [checkingAll, setCheckingAll] = useState(false);
  // Read through a ref so checkItems stays stable: depending on the GUID would
  // re-run the automatic check on every keystroke in the GUID field.
  const feedRef = useRef(publisherFeed);
  useEffect(() => {
    feedRef.current = publisherFeed;
  });

  const runChecks = useCallback(async (items: RemoteItem[], skipLinked: boolean) => {
    const guid = feedRef.current?.podcastGuid ?? '';
    const queue = selectItemsToCheck(items, guid, resultsRef.current, skipLinked);
    if (queue.length === 0) return;

    // Yield first: this also runs from an effect, which must not set state synchronously.
    await Promise.resolve();
    setResults(prev => ({ ...prev, ...Object.fromEntries(queue.map(item => [keyFor(guid, item), 'checking' as const])) }));

    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const result = await checkAlbumLinkBack(item, guid);
        const key = keyFor(guid, item);
        setResults(prev => ({ ...prev, [key]: result }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, worker));
  }, [setResults]);

  const checkItems = useCallback((items: RemoteItem[]) => runChecks(items, false), [runChecks]);

  const markLinked = useCallback((items: RemoteItem[]) => {
    const guid = feedRef.current?.podcastGuid ?? '';
    setResults(prev => ({ ...prev, ...Object.fromEntries(items.map(item => [keyFor(guid, item), { status: 'linked' as const }])) }));
  }, [setResults]);

  const checkAll = useCallback(async () => {
    setCheckingAll(true);
    try {
      await checkItems(feedRef.current?.remoteItems ?? []);
    } finally {
      setCheckingAll(false);
    }
  }, [checkItems]);

  useEffect(() => {
    void runChecks((feedRef.current?.remoteItems ?? []).filter(item => isMspHosted(item.feedUrl ?? '')), true);
  }, [feedInstance, runChecks]);

  const statusFor = (item: RemoteItem) => results[keyFor(publisherFeed?.podcastGuid ?? '', item)];

  return { statusFor, checkItems, checkAll, markLinked, checkingAll };
}
