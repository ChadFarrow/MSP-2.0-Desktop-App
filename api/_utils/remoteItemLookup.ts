import { getAuthHeaders } from './podcastIndex.js';
import { parseBoostPayload } from './boostRecord.js';
import type { ParsedBoost } from './boostRecord.js';

const PI_BASE = 'https://api.podcastindex.org/api/1.0';
const TIMEOUT_MS = 5000;

export interface RemoteItemTitles {
  remoteEpisode: string;
  remotePodcast?: string;
}

/**
 * A remote item's title and its feed's title, from Podcast Index — the two fields
 * Helipad fills itself as `remote_episode` / `remote_podcast`. The API answers a miss
 * with `"episode": []` rather than omitting it, which reads here as nothing found.
 * Null on any failure: a missing title falls back to the listener's message, and a
 * boost is never refused because Podcast Index was slow.
 */
export async function lookupRemoteItem(feedGuid: string, itemGuid: string): Promise<RemoteItemTitles | null> {
  const headers = getAuthHeaders();
  if (!headers) return null;
  const url = `${PI_BASE}/episodes/byguid?guid=${encodeURIComponent(itemGuid)}&podcastguid=${encodeURIComponent(feedGuid)}`;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const body = await response.json() as { episode?: { title?: unknown; feedTitle?: unknown } };
    const episode = body.episode;
    const title = typeof episode?.title === 'string' ? episode.title.trim() : '';
    if (!title) return null;
    const feedTitle = typeof episode?.feedTitle === 'string' ? episode.feedTitle.trim() : '';
    return { remoteEpisode: title, ...(feedTitle ? { remotePodcast: feedTitle } : {}) };
  } catch {
    return null;
  }
}

/**
 * For msp-bot's records, do at ingest what Helipad did itself: add the remote item's
 * titles before the raw write, so a rebuild never needs Podcast Index again. Lookups run
 * in parallel so a batch fits the function timeout even when every one times out.
 */
export async function enrichWithRemoteTitles<E extends { parsed: ParsedBoost; payload: unknown }>(
  entries: E[]
): Promise<E[]> {
  return Promise.all(entries.map(async (entry) => {
    const { parsed } = entry;
    const feedGuid = typeof parsed.tlv.remote_feed_guid === 'string' ? parsed.tlv.remote_feed_guid : '';
    const itemGuid = typeof parsed.tlv.remote_item_guid === 'string' ? parsed.tlv.remote_item_guid : '';
    if (parsed.source !== 'boostbox' || !feedGuid || !itemGuid || parsed.remoteEpisode) return entry;

    const found = await lookupRemoteItem(feedGuid, itemGuid);
    if (!found) return entry;

    const payload = {
      ...(entry.payload as Record<string, unknown>),
      remote_episode: found.remoteEpisode,
      ...(found.remotePodcast ? { remote_podcast: found.remotePodcast } : {}),
      resolved_by: 'podcastindex'
    };
    const reparsed = parseBoostPayload(payload);
    return reparsed ? { ...entry, parsed: reparsed, payload } : entry;
  }));
}
