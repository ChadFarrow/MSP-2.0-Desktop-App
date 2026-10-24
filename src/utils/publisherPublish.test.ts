import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RemoteItem } from '../types/feed';

vi.mock('./nostrSigner', () => ({
  hasSigner: vi.fn(() => false),
  checkSignerConnection: vi.fn(async () => ({ connected: true })),
}));
vi.mock('./emailSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./emailSession')>()),
  isEmailLoggedIn: vi.fn(() => false),
}));
vi.mock('./hostedFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./hostedFeed')>()),
  getHostedFeedInfo: vi.fn(() => null),
  updateHostedFeed: vi.fn(async () => ({})),
  updateHostedFeedWithNostr: vi.fn(async () => ({})),
  updateHostedFeedWithEmail: vi.fn(async () => ({})),
}));
vi.mock('./publisherControl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./publisherControl')>()),
  fetchCatalogFeedXml: vi.fn(),
}));

import {
  catalogResultTone,
  linkedAfterPublish,
  processCatalogFeed,
  publishPublisherFeed,
  shouldShowPublishSection,
  summarizeCatalogUpdates,
  type FeedUpdateResult
} from './publisherPublish';
import { createEmptyPublisherFeed } from '../types/feed';
import { fetchCatalogFeedXml } from './publisherControl';
import {
  HostedFeedError,
  getHostedFeedInfo,
  updateHostedFeed,
  updateHostedFeedWithEmail,
  updateHostedFeedWithNostr
} from './hostedFeed';
import { checkSignerConnection, hasSigner } from './nostrSigner';
import { isEmailLoggedIn } from './emailSession';

const PUBLISHER = 'e3e2e758-6c83-41e3-87f2-d3c64d3011f8';
const PUBLISHER_URL = `https://musicsideproject.com/api/hosted/${PUBLISHER}.xml`;
const ALBUM = '27735a10-3775-503d-b038-70b4b7d536ab';
const MSP_URL = `https://new.musicsideproject.com/api/hosted/${ALBUM}.xml`;
const WAVLAKE_URL = 'https://wavlake.com/feed/music/a82acc2f-3440-491c-94c2-d27bebf6cfe6';
const SELF_URL = 'https://headstarts.uk/msp/longy/Lady/Lady-You-Shot-Me.xml';

const albumXml = (publisherXml = '') => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">
  <channel>
    <title>The EP (Amnesia)</title>
    <description>d</description>
    <podcast:guid>${ALBUM}</podcast:guid>
    <podcast:medium>music</podcast:medium>
    ${publisherXml}
  </channel>
</rss>`;

const item = (feedUrl: string, feedGuid = ALBUM): RemoteItem => ({ feedGuid, feedUrl, title: 'Album', medium: 'music' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHostedFeedInfo).mockReturnValue(null);
  vi.mocked(hasSigner).mockReturnValue(false);
  vi.mocked(isEmailLoggedIn).mockReturnValue(false);
  vi.mocked(updateHostedFeedWithNostr).mockResolvedValue({} as never);
  vi.mocked(updateHostedFeedWithEmail).mockResolvedValue({} as never);
  // processCatalogFeed fires a background /api/pubnotify after an update.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })));
});

describe('shouldShowPublishSection', () => {
  it('shows when any catalog album is on MSP', () => {
    expect(shouldShowPublishSection([item(MSP_URL), item(WAVLAKE_URL), item(SELF_URL)])).toBe(true);
  });
  it('hides when no catalog album is on MSP', () => {
    expect(shouldShowPublishSection([item(WAVLAKE_URL), item(SELF_URL)])).toBe(false);
    expect(shouldShowPublishSection([])).toBe(false);
  });
});

describe('processCatalogFeed', () => {
  it('skips a self-hosted album without fetching it', async () => {
    const result = await processCatalogFeed(item(SELF_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('skipped');
    expect(result.message).toBe('Not on MSP: upload the new version from Download Catalog to your host');
    expect(fetchCatalogFeedXml).not.toHaveBeenCalled();
  });

  it('skips a Wavlake album without fetching it', async () => {
    const result = await processCatalogFeed(item(WAVLAKE_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('skipped');
    expect(result.message).toBe("Hosted on Wavlake: can't be updated");
    expect(fetchCatalogFeedXml).not.toHaveBeenCalled();
  });

  it('fetches an MSP album through fetchCatalogFeedXml', async () => {
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml());
    await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(fetchCatalogFeedXml).toHaveBeenCalledWith(MSP_URL);
  });

  it('leaves an MSP album that names another publisher alone', async () => {
    const other = '<podcast:publisher><podcast:remoteItem medium="publisher" feedGuid="c0d95236-3400-43e6-9721-d3904f182767"/></podcast:publisher>';
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml(other));
    vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: ALBUM, editToken: 't', createdAt: 0, lastUpdated: 0 });
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('skipped');
    expect(result.message).toBe('Names a different publisher feed: left unchanged');
    expect(updateHostedFeed).not.toHaveBeenCalled();
    expect(updateHostedFeedWithNostr).not.toHaveBeenCalled();
  });

  it('updates its own entry in an album that names two publishers, and keeps the other', async () => {
    const ARTIST = 'c0d95236-3400-43e6-9721-d3904f182767';
    const two = '<podcast:publisher>' +
      `<podcast:remoteItem medium="publisher" rel="artist" feedGuid="${ARTIST}"/>` +
      `<podcast:remoteItem medium="publisher" feedGuid="${PUBLISHER.toUpperCase()}"/>` +
      '</podcast:publisher>';
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml(two));
    vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: ALBUM, editToken: 't', createdAt: 0, lastUpdated: 0 });
    const result = await processCatalogFeed({ ...item(MSP_URL), rel: 'label' }, PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('updated');
    const xml = vi.mocked(updateHostedFeed).mock.calls[0][2];
    expect(xml.match(/<podcast:remoteItem medium="publisher"/g)).toHaveLength(2);
    expect(xml.indexOf(`feedGuid="${ARTIST}" rel="artist"`))
      .toBeLessThan(xml.indexOf(`feedGuid="${PUBLISHER}" feedUrl="${PUBLISHER_URL}" rel="label"`));
  });

  it('adds itself after the publisher an album names, with addParty (beta)', async () => {
    const ARTIST = 'c0d95236-3400-43e6-9721-d3904f182767';
    const other = `<podcast:publisher><podcast:remoteItem medium="publisher" rel="artist" feedGuid="${ARTIST}"/></podcast:publisher>`;
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml(other));
    vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: ALBUM, editToken: 't', createdAt: 0, lastUpdated: 0 });
    const result = await processCatalogFeed({ ...item(MSP_URL), rel: 'label' }, PUBLISHER, PUBLISHER_URL, { addParty: true });
    expect(result.status).toBe('updated');
    const xml = vi.mocked(updateHostedFeed).mock.calls[0][2];
    expect(xml.indexOf(`feedGuid="${ARTIST}" rel="artist"`))
      .toBeLessThan(xml.indexOf(`feedGuid="${PUBLISHER}" feedUrl="${PUBLISHER_URL}" rel="label"`));
  });

  it('still updates an MSP album it has a record for', async () => {
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml());
    vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: ALBUM, editToken: 't', createdAt: 0, lastUpdated: 0 });
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('updated');
    expect(updateHostedFeed).toHaveBeenCalledTimes(1);
    const [feedId, token, xml] = vi.mocked(updateHostedFeed).mock.calls[0];
    expect(feedId).toBe(ALBUM);
    expect(token).toBe('t');
    expect(xml).toContain(`feedGuid="${PUBLISHER}"`);
  });
});

// A browser record is per site address, so publishing from a different address
// (or a different browser) has none. The server accepts the signed-in owner.
describe('processCatalogFeed without a browser record', () => {
  beforeEach(() => {
    vi.mocked(fetchCatalogFeedXml).mockResolvedValue(albumXml());
  });

  it('updates an MSP album with no record as the Nostr owner', async () => {
    vi.mocked(hasSigner).mockReturnValue(true);
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('updated');
    expect(vi.mocked(updateHostedFeedWithNostr).mock.calls[0][0]).toBe(ALBUM);
  });

  it('falls back to the email owner when Nostr is refused', async () => {
    vi.mocked(hasSigner).mockReturnValue(true);
    vi.mocked(isEmailLoggedIn).mockReturnValue(true);
    vi.mocked(updateHostedFeedWithNostr).mockRejectedValue(new HostedFeedError('Invalid credentials', 403));
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('updated');
    expect(vi.mocked(updateHostedFeedWithEmail).mock.calls[0][0]).toBe(ALBUM);
  });

  it("skips an album the signed-in account doesn't own", async () => {
    vi.mocked(hasSigner).mockReturnValue(true);
    vi.mocked(isEmailLoggedIn).mockReturnValue(true);
    vi.mocked(updateHostedFeedWithNostr).mockRejectedValue(new HostedFeedError('Invalid credentials', 403));
    vi.mocked(updateHostedFeedWithEmail).mockRejectedValue(new HostedFeedError('Invalid credentials', 403));
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('skipped');
    expect(result.message).toBe('Not owned by your signed-in account');
  });

  it('keeps "No credentials" when nobody is signed in', async () => {
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('skipped');
    expect(result.message).toBe('No credentials');
    expect(updateHostedFeedWithNostr).not.toHaveBeenCalled();
    expect(updateHostedFeedWithEmail).not.toHaveBeenCalled();
  });

  it('reports a non-refusal failure as an error', async () => {
    vi.mocked(hasSigner).mockReturnValue(true);
    vi.mocked(updateHostedFeedWithNostr).mockRejectedValue(new HostedFeedError('Server error', 500));
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('error');
  });

  it('uses the owner when the record has no usable credential', async () => {
    vi.mocked(getHostedFeedInfo).mockReturnValue({ feedId: ALBUM, editToken: '', createdAt: 0, lastUpdated: 0 });
    vi.mocked(hasSigner).mockReturnValue(true);
    const result = await processCatalogFeed(item(MSP_URL), PUBLISHER, PUBLISHER_URL);
    expect(result.status).toBe('updated');
    expect(updateHostedFeedWithNostr).toHaveBeenCalledTimes(1);
  });
});

describe('after a publish', () => {
  const result = (feedGuid: string, status: FeedUpdateResult['status']): FeedUpdateResult => ({ title: feedGuid, feedGuid, status });

  it('takes link-back status from the publish results, not from re-reading', () => {
    // The blob CDN can serve the pre-publish XML for up to 60 s after the write.
    const items = [item(MSP_URL, 'a'), item(MSP_URL.replace(ALBUM, 'b'), 'b'), item(SELF_URL, 'c')];
    const linked = linkedAfterPublish([result('a', 'updated'), result('b', 'skipped'), result('c', 'skipped')], items);
    expect(linked.map(i => i.feedGuid)).toEqual(['a']);
  });

  it('counts skipped albums in the summary', () => {
    expect(summarizeCatalogUpdates([result('a', 'updated'), result('b', 'skipped'), result('c', 'skipped')]))
      .toBe('1 updated, 2 skipped');
  });

  it('never calls a run that updated nothing "Complete"', () => {
    expect(summarizeCatalogUpdates([result('a', 'skipped')])).toBe('1 skipped');
    expect(summarizeCatalogUpdates([result('a', 'error'), result('b', 'skipped')])).toBe('1 failed, 1 skipped');
  });

  it('shows a skipped album as neutral, not as an error', () => {
    expect(catalogResultTone('updated')).toBe('ok');
    expect(catalogResultTone('skipped')).toBe('neutral');
    expect(catalogResultTone('error')).toBe('error');
  });
});

describe('publishPublisherFeed signer pre-flight', () => {
  it('stops before any request when the Nostr signer is not connected', async () => {
    vi.mocked(hasSigner).mockReturnValue(true);
    vi.mocked(checkSignerConnection).mockResolvedValue({ connected: false, error: 'Open your signer app and approve.' });
    const feed = { ...createEmptyPublisherFeed(), title: 'Strange Love', remoteItems: [item(MSP_URL)] };
    const result = await publishPublisherFeed(feed, {
      hostCatalogFeeds: false, updateCatalogFeeds: true, linkNostr: true, nostrPubkey: 'fd2e', onProgress: () => {}
    });
    expect(result).toEqual({ success: false, error: 'Open your signer app and approve.' });
    expect(fetch).not.toHaveBeenCalled();
    expect(fetchCatalogFeedXml).not.toHaveBeenCalled();
  });
});
