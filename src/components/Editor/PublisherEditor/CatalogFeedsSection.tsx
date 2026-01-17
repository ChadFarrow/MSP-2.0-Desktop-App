import { useState } from 'react';
import type { PublisherFeed, RemoteItem } from '../../../types/feed';
import { createEmptyRemoteItem } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { InfoIcon } from '../../InfoIcon';
import { Section } from '../../Section';
import { fetchFeedFromUrl, parseRssFeed } from '../../../utils/xmlParser';
import { generateRssFeed, downloadXml } from '../../../utils/xmlGenerator';
import { getHostedFeedInfo, updateHostedFeed, buildHostedUrl } from '../../../utils/hostedFeed';

// Types for publisher reference update results
interface FeedUpdateResult {
  title: string;
  feedGuid: string;
  status: 'updated' | 'downloaded' | 'error';
  message?: string;
}

interface SearchResult {
  id: number;
  title: string;
  podcastGuid: string;
  url: string;
  image: string;
}

// Field info for publisher-specific fields
const PUBLISHER_FIELD_INFO = {
  remoteItemFeedGuid: 'The podcast:guid of the feed you want to include in your publisher catalog. This is the unique identifier that links to the feed.',
  remoteItemFeedUrl: 'The URL of the RSS feed (optional but recommended). This helps apps find the feed if they cannot resolve the GUID.',
  remoteItemTitle: 'A display title for this feed (optional). If not provided, apps will fetch the title from the feed itself.',
};

// Helper to check if a feed URL is MSP-hosted
const isMspHosted = (url: string): boolean => {
  if (!url) return false;
  return (
    url.includes('/api/hosted/') ||
    url.includes('msp.podtards.com') ||
    url.includes('msp-2-0')
  );
};

// Helper to extract feedId from MSP hosted URL
const extractFeedIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/api\/hosted\/([a-zA-Z0-9-]+)(?:\.xml)?/);
  return match ? match[1] : null;
};

interface CatalogFeedsSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function CatalogFeedsSection({ publisherFeed, dispatch }: CatalogFeedsSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Publisher reference update state
  const [isAddingReferences, setIsAddingReferences] = useState(false);
  const [referenceResults, setReferenceResults] = useState<FeedUpdateResult[] | null>(null);

  // Refresh artwork state
  const [refreshingIndex, setRefreshingIndex] = useState<number | null>(null);

  // Refresh feed info from Podcast Index by GUID
  const handleRefreshArtwork = async (index: number) => {
    const item = publisherFeed.remoteItems[index];
    if (!item.feedGuid) return;

    setRefreshingIndex(index);
    try {
      const response = await fetch(`/api/pisearch?q=${encodeURIComponent(item.feedGuid)}`);
      const data = await response.json();

      if (response.ok && data.feeds && data.feeds.length > 0) {
        const feed = data.feeds[0];
        dispatch({
          type: 'UPDATE_REMOTE_ITEM',
          payload: {
            index,
            item: {
              ...item,
              image: feed.image || item.image,
              title: feed.title || item.title,
              feedUrl: feed.url || item.feedUrl
            }
          }
        });
      }
    } catch {
      // Silent fail
    } finally {
      setRefreshingIndex(null);
    }
  };

  // Get hosted URL for the current publisher feed
  const getPublisherFeedUrl = (): string | null => {
    if (!publisherFeed.podcastGuid) return null;
    const hostedInfo = getHostedFeedInfo(publisherFeed.podcastGuid);
    if (hostedInfo) {
      return buildHostedUrl(hostedInfo.feedId);
    }
    return null;
  };

  // Notify Podcast Index about a feed update
  const notifyPodcastIndex = async (feedUrl: string): Promise<void> => {
    try {
      await fetch(`/api/pubnotify?url=${encodeURIComponent(feedUrl)}`);
    } catch {
      // Silent fail - notification is best effort
    }
  };

  // Process a single feed to add publisher reference
  const processFeed = async (
    item: RemoteItem,
    publisherGuid: string,
    publisherFeedUrl: string
  ): Promise<FeedUpdateResult> => {
    const feedUrl = item.feedUrl;
    const title = item.title || item.feedGuid;

    if (!feedUrl) {
      return {
        title,
        feedGuid: item.feedGuid,
        status: 'error',
        message: 'No feed URL available'
      };
    }

    try {
      // Fetch and parse the feed
      const xml = await fetchFeedFromUrl(feedUrl);
      const album = parseRssFeed(xml);

      // Add/update publisher reference
      album.publisher = {
        feedGuid: publisherGuid,
        feedUrl: publisherFeedUrl
      };

      // Generate updated XML
      const updatedXml = generateRssFeed(album);
      const feedTitle = album.title || title;

      // Check if MSP-hosted and has credentials
      if (isMspHosted(feedUrl)) {
        const feedId = extractFeedIdFromUrl(feedUrl);
        if (feedId) {
          const hostedInfo = getHostedFeedInfo(album.podcastGuid);
          if (hostedInfo && hostedInfo.feedId === feedId) {
            // We have credentials - update directly
            await updateHostedFeed(feedId, hostedInfo.editToken, updatedXml, feedTitle);
            await notifyPodcastIndex(feedUrl);
            return {
              title: feedTitle,
              feedGuid: item.feedGuid,
              status: 'updated',
              message: 'Updated on MSP and notified Podcast Index'
            };
          }
        }
      }

      // No credentials or not MSP-hosted - download for manual upload
      const safeTitle = feedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'feed';
      const filename = `${safeTitle}-with-publisher.xml`;
      downloadXml(updatedXml, filename);
      return {
        title: feedTitle,
        feedGuid: item.feedGuid,
        status: 'downloaded',
        message: 'Downloaded XML for manual upload'
      };
    } catch (err) {
      return {
        title,
        feedGuid: item.feedGuid,
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to process feed'
      };
    }
  };

  // Handle adding publisher reference to all catalog feeds
  const handleAddPublisherReference = async () => {
    const publisherGuid = publisherFeed.podcastGuid;
    const publisherFeedUrl = getPublisherFeedUrl();

    if (!publisherGuid) {
      setReferenceResults([{
        title: 'Error',
        feedGuid: '',
        status: 'error',
        message: 'Publisher feed must have a GUID'
      }]);
      return;
    }

    if (!publisherFeedUrl) {
      setReferenceResults([{
        title: 'Error',
        feedGuid: '',
        status: 'error',
        message: 'Publisher feed must be hosted first. Use Save > Host on MSP.'
      }]);
      return;
    }

    if (publisherFeed.remoteItems.length === 0) {
      setReferenceResults([{
        title: 'Error',
        feedGuid: '',
        status: 'error',
        message: 'No catalog feeds to update'
      }]);
      return;
    }

    setIsAddingReferences(true);
    setReferenceResults(null);

    const results: FeedUpdateResult[] = [];

    for (const item of publisherFeed.remoteItems) {
      const result = await processFeed(item, publisherGuid, publisherFeedUrl);
      results.push(result);
    }

    setReferenceResults(results);
    setIsAddingReferences(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const response = await fetch(`/api/pisearch?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();

      if (!response.ok) {
        setSearchError(data.error || 'Search failed');
        return;
      }

      setSearchResults(data.feeds || []);
    } catch {
      setSearchError('Failed to search');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddFromSearch = (result: SearchResult) => {
    dispatch({
      type: 'ADD_REMOTE_ITEM',
      payload: {
        ...createEmptyRemoteItem(),
        feedGuid: result.podcastGuid,
        feedUrl: result.url,
        title: result.title,
        image: result.image
      }
    });
    setSearchResults(prev => prev.filter(r => r.id !== result.id));
  };

  return (
    <Section title="Catalog Feeds" icon="&#128218;">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
        Add the feeds that belong to this publisher. Search by name, Podcast Index ID, or podcastindex.org URL.
      </p>

      {/* Search UI */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search by name, ID, or podcastindex.org URL..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
          >
            {isSearching ? 'Searching...' : 'Search Directory'}
          </button>
        </div>

        {searchError && (
          <p style={{ color: 'var(--danger-color)', fontSize: '14px', marginBottom: '12px' }}>{searchError}</p>
        )}

        {searchResults.length > 0 && (
          <div style={{
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            overflow: 'hidden',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              backgroundColor: 'var(--surface-color)',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              </span>
              <button
                className="btn btn-icon"
                onClick={() => { setSearchResults([]); setSearchQuery(''); }}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                Close
              </button>
            </div>
            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
            {searchResults.map(result => (
              <div
                key={result.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px',
                  gap: '12px',
                  borderBottom: '1px solid var(--border-color)'
                }}
              >
                <img
                  src={result.image}
                  alt=""
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                    backgroundColor: 'var(--surface-color)'
                  }}
                  onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                />
                <span style={{ flex: 1, fontWeight: 500 }}>{result.title}</span>
                <button
                  className="btn btn-primary"
                  onClick={() => handleAddFromSearch(result)}
                  style={{ padding: '6px 16px' }}
                >
                  Add
                </button>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      <div className="repeatable-list">
        {publisherFeed.remoteItems.map((item, index) => (
          <div key={index} className="repeatable-item">
            <div className="repeatable-item-content" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              {/* Album Art Preview */}
              <div style={{ flexShrink: 0, position: 'relative' }}>
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.title || 'Feed artwork'}
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '8px',
                      objectFit: 'cover',
                      backgroundColor: 'var(--surface-color)',
                      border: '1px solid var(--border-color)'
                    }}
                    onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                  />
                ) : (
                  <button
                    onClick={() => handleRefreshArtwork(index)}
                    disabled={refreshingIndex === index || !item.feedGuid}
                    title="Fetch artwork from Podcast Index"
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface-color)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                      cursor: item.feedGuid ? 'pointer' : 'default',
                      gap: '4px'
                    }}
                  >
                    {refreshingIndex === index ? (
                      <span>...</span>
                    ) : (
                      <>
                        <span style={{ fontSize: '20px' }}>&#128260;</span>
                        <span>Refresh</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              {/* Form Fields */}
              <div style={{ flex: 1 }}>
                <div className="form-grid">
                  <div className="form-group" style={{ width: '80px' }}>
                    <label className="form-label">Order</label>
                    <input
                      type="number"
                      className="form-input"
                      min="1"
                      value={index + 1}
                      onChange={e => {
                        const newIndex = parseInt(e.target.value) - 1;
                        if (!isNaN(newIndex) && newIndex >= 0 && newIndex < publisherFeed.remoteItems.length && newIndex !== index) {
                          dispatch({ type: 'REORDER_REMOTE_ITEMS', payload: { fromIndex: index, toIndex: newIndex } });
                        }
                      }}
                      style={{ textAlign: 'center' }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Display Title<InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemTitle} /></label>
                    <input
                      type="text"
                      className="form-input"
                      value={item.title || ''}
                      disabled
                      style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'default', opacity: 1 }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Feed GUID <span className="required">*</span><InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemFeedGuid} /></label>
                    <input
                      type="text"
                      className="form-input"
                      value={item.feedGuid || ''}
                      disabled
                      style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'default', opacity: 1 }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Feed URL<InfoIcon text={PUBLISHER_FIELD_INFO.remoteItemFeedUrl} /></label>
                    <input
                      type="url"
                      className="form-input"
                      value={item.feedUrl || ''}
                      disabled
                      style={{ backgroundColor: 'var(--bg-secondary)', cursor: 'default', opacity: 1 }}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="repeatable-item-actions">
              <button
                className="btn btn-icon btn-danger"
                onClick={() => dispatch({ type: 'REMOVE_REMOTE_ITEM', payload: index })}
              >
                &#10005;
              </button>
            </div>
          </div>
        ))}
        <button
          className="add-item-btn"
          onClick={() => dispatch({ type: 'ADD_REMOTE_ITEM', payload: createEmptyRemoteItem() })}
        >
          + Add Feed
        </button>
      </div>

      {/* Add Publisher Reference Button */}
      {publisherFeed.remoteItems.length > 0 && (
        <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <button
              className="btn btn-secondary"
              onClick={handleAddPublisherReference}
              disabled={isAddingReferences || !publisherFeed.podcastGuid}
              title={!publisherFeed.podcastGuid ? 'Publisher feed must have a GUID' : undefined}
            >
              {isAddingReferences ? 'Processing...' : 'Add Publisher Reference to Feeds'}
            </button>
            <InfoIcon text="Updates each catalog feed with a <podcast:publisher> tag linking back to this publisher feed. MSP-hosted feeds with saved credentials will be updated automatically; others will be downloaded for manual upload." />
          </div>

          {/* Results Summary */}
          {referenceResults && (
            <div style={{
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: 'var(--surface-color)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)'
              }}>
                <span style={{ fontWeight: 500 }}>Results</span>
                <button
                  className="btn btn-icon"
                  onClick={() => setReferenceResults(null)}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  Close
                </button>
              </div>
              <div style={{ padding: '8px 0' }}>
                {referenceResults.map((result, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      gap: '8px',
                      borderBottom: idx < referenceResults.length - 1 ? '1px solid var(--border-color)' : 'none'
                    }}
                  >
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      backgroundColor: result.status === 'updated' ? 'var(--success-color)' :
                                       result.status === 'downloaded' ? 'var(--warning-color)' :
                                       'var(--danger-color)',
                      color: 'white'
                    }}>
                      {result.status === 'updated' ? '✓' :
                       result.status === 'downloaded' ? '↓' : '!'}
                    </span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{result.title}</span>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {result.message}
                    </span>
                  </div>
                ))}
              </div>
              {/* Summary counts */}
              <div style={{
                padding: '12px',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                {(() => {
                  const updated = referenceResults.filter(r => r.status === 'updated').length;
                  const downloaded = referenceResults.filter(r => r.status === 'downloaded').length;
                  const errors = referenceResults.filter(r => r.status === 'error').length;
                  const parts = [];
                  if (updated > 0) parts.push(`${updated} updated on MSP`);
                  if (downloaded > 0) parts.push(`${downloaded} downloaded`);
                  if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
                  return parts.join(' • ') || 'No feeds processed';
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
