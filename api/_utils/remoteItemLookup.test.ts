import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHeaders } = vi.hoisted(() => ({ mockHeaders: vi.fn() }));
vi.mock('./podcastIndex.js', () => ({ getAuthHeaders: mockHeaders }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { lookupRemoteItem, enrichWithRemoteTitles } from './remoteItemLookup.js';
import { parseBoostPayload } from './boostRecord.js';

const FEED = '917393e3-1b1e-5cef-ace4-edaa54e1f810';
const ITEM = 'song-guid-1';
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

function botEntry(tlv: Record<string, unknown>, outer: Record<string, unknown> = {}) {
  const payload = {
    source: 'boostbox', payment_hash: 'a'.repeat(64), direction: 'incoming',
    time: 1790000000, value_msat: 1000, tlv: JSON.stringify(tlv), ...outer
  };
  return { parsed: parseBoostPayload(payload)!, payload };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockReturnValue({ 'X-Auth-Key': 'k' });
});

describe('lookupRemoteItem', () => {
  it('asks Podcast Index for the item within its feed and returns both titles', async () => {
    mockFetch.mockReturnValue(ok({ status: 'true', episode: { title: 'Nede ved Myre', feedTitle: 'Transcendental Object' } }));
    expect(await lookupRemoteItem(FEED, ITEM))
      .toEqual({ remoteEpisode: 'Nede ved Myre', remotePodcast: 'Transcendental Object' });
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('https://api.podcastindex.org/api/1.0/episodes/byguid?');
    expect(url).toContain(`guid=${ITEM}`);
    expect(url).toContain(`podcastguid=${FEED}`);
  });

  it('reads a miss answered as an empty array as nothing found', async () => {
    mockFetch.mockReturnValue(ok({ status: 'true', episode: [] }));
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
  });

  it('gives up quietly on an error, a timeout, or missing credentials', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted'));
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
    mockHeaders.mockReturnValue(null);
    expect(await lookupRemoteItem(FEED, ITEM)).toBeNull();
  });
});

describe('enrichWithRemoteTitles', () => {
  it('adds the titles to a bot record before it is stored, and says where they came from', async () => {
    mockFetch.mockReturnValue(ok({ episode: { title: 'Song', feedTitle: 'Album' } }));
    const [entry] = await enrichWithRemoteTitles([
      botEntry({ name: 'MSP 2.0', remote_feed_guid: FEED, remote_item_guid: ITEM })
    ]);
    expect(entry.parsed.remoteEpisode).toBe('Song');
    expect(entry.parsed.remotePodcast).toBe('Album');
    expect(entry.payload).toMatchObject({ remote_episode: 'Song', remote_podcast: 'Album', resolved_by: 'podcastindex' });
  });

  it('leaves a record as it was when the lookup finds nothing', async () => {
    mockFetch.mockReturnValue(ok({ episode: [] }));
    const original = botEntry({ remote_feed_guid: FEED, remote_item_guid: ITEM });
    const [entry] = await enrichWithRemoteTitles([original]);
    expect(entry).toBe(original);
  });

  it('never looks up a Helipad record, or a bot record that already has a title', async () => {
    const helipad = {
      parsed: parseBoostPayload({ index: 1, direction: 'incoming', time: 1, tlv: JSON.stringify({ remote_feed_guid: FEED, remote_item_guid: ITEM }) })!,
      payload: {}
    };
    const titled = botEntry({ remote_feed_guid: FEED, remote_item_guid: ITEM }, { remote_episode: 'Known' });
    await enrichWithRemoteTitles([helipad, titled]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
