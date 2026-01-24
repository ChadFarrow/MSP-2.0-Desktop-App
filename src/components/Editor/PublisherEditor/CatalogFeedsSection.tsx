import { useState } from 'react';
import type { PublisherFeed } from '../../../types/feed';
import { createEmptyRemoteItem } from '../../../types/feed';
import type { FeedAction } from '../../../store/feedStore';
import { useNostr } from '../../../store/nostrStore';
import { createAdminAuthHeader } from '../../../utils/adminAuth';
import { InfoIcon } from '../../InfoIcon';
import { Section } from '../../Section';

interface SearchResult {
  id: number;
  title: string;
  podcastGuid: string;
  url: string;
  image: string;
}

interface MspFeed {
  feedId: string;
  title: string;
  author?: string;
  medium?: string;
  createdAt?: string;
}

// Field info for publisher-specific fields
const PUBLISHER_FIELD_INFO = {
  remoteItemFeedGuid: 'The podcast:guid of the feed you want to include in your publisher catalog. This is the unique identifier that links to the feed.',
  remoteItemFeedUrl: 'The URL of the RSS feed (optional but recommended). This helps apps find the feed if they cannot resolve the GUID.',
  remoteItemTitle: 'A display title for this feed (optional). If not provided, apps will fetch the title from the feed itself.',
};

interface CatalogFeedsSectionProps {
  publisherFeed: PublisherFeed;
  dispatch: React.Dispatch<FeedAction>;
}

export function CatalogFeedsSection({ publisherFeed, dispatch }: CatalogFeedsSectionProps) {
  const { state: nostrState } = useNostr();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Refresh artwork state
  const [refreshingIndex, setRefreshingIndex] = useState<number | null>(null);

  // My MSP Feeds state
  const [myFeeds, setMyFeeds] = useState<MspFeed[]>([]);
  const [loadingMyFeeds, setLoadingMyFeeds] = useState(false);
  const [myFeedsError, setMyFeedsError] = useState('');
  const [showMyFeeds, setShowMyFeeds] = useState(false);

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

  // Fetch user's own MSP-hosted feeds
  const handleFetchMyFeeds = async () => {
    if (!nostrState.isLoggedIn || !nostrState.user?.pubkey) return;

    setLoadingMyFeeds(true);
    setMyFeedsError('');
    setMyFeeds([]);
    setShowMyFeeds(true);

    try {
      const url = `${window.location.origin}/api/hosted/`;
      const authHeader = await createAdminAuthHeader(url, 'GET');

      const response = await fetch('/api/hosted/', {
        headers: { 'Authorization': authHeader }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch feeds');
      }

      const data = await response.json();

      // Filter to only show feeds owned by the current user
      const userFeeds = (data.feeds || []).filter(
        (feed: MspFeed & { ownerPubkey?: string }) => feed.ownerPubkey === nostrState.user?.pubkey
      );

      // For each feed, try to extract medium from the XML
      const feedsWithMedium = await Promise.all(
        userFeeds.map(async (feed: MspFeed) => {
          try {
            const feedResponse = await fetch(`/api/hosted/${feed.feedId}.xml`);
            if (feedResponse.ok) {
              const xml = await feedResponse.text();
              // Extract medium from XML
              const mediumMatch = xml.match(/<podcast:medium>([^<]+)<\/podcast:medium>/);
              return { ...feed, medium: mediumMatch?.[1] || 'music' };
            }
          } catch {
            // Silent fail - default to music
          }
          return { ...feed, medium: 'music' };
        })
      );

      setMyFeeds(feedsWithMedium);
    } catch (err) {
      setMyFeedsError(err instanceof Error ? err.message : 'Failed to fetch feeds');
    } finally {
      setLoadingMyFeeds(false);
    }
  };

  // Add feed from My MSP Feeds
  const handleAddFromMyFeeds = (feed: MspFeed) => {
    // Check if already in catalog
    const alreadyExists = publisherFeed.remoteItems.some(item => item.feedGuid === feed.feedId);
    if (alreadyExists) return;

    dispatch({
      type: 'ADD_REMOTE_ITEM',
      payload: {
        ...createEmptyRemoteItem(),
        feedGuid: feed.feedId,
        feedUrl: `${window.location.origin}/api/hosted/${feed.feedId}.xml`,
        title: feed.title || 'Untitled Feed',
        medium: feed.medium
      }
    });

    // Remove from displayed list
    setMyFeeds(prev => prev.filter(f => f.feedId !== feed.feedId));
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
        <strong style={{ display: 'block', marginTop: '8px', color: 'var(--text-primary)' }}>
          Note: All catalog feeds must be in the Podcast Index for the publisher reference to work.
        </strong>
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

        {/* My MSP Feeds Section */}
        {nostrState.isLoggedIn && (
          <div style={{ marginBottom: '16px' }}>
            <button
              className="btn btn-secondary"
              onClick={handleFetchMyFeeds}
              disabled={loadingMyFeeds}
              style={{ marginBottom: '12px' }}
            >
              {loadingMyFeeds ? 'Loading...' : '📂 Browse My MSP Feeds'}
            </button>

            {myFeedsError && (
              <p style={{ color: 'var(--danger-color)', fontSize: '14px', marginBottom: '12px' }}>{myFeedsError}</p>
            )}

            {showMyFeeds && myFeeds.length === 0 && !loadingMyFeeds && !myFeedsError && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px' }}>
                No MSP-hosted feeds found linked to your Nostr identity.
              </p>
            )}

            {myFeeds.length > 0 && (
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
                    My MSP Feeds ({myFeeds.length})
                  </span>
                  <button
                    className="btn btn-icon"
                    onClick={() => { setMyFeeds([]); setShowMyFeeds(false); }}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  {myFeeds.map(feed => {
                    const alreadyInCatalog = publisherFeed.remoteItems.some(item => item.feedGuid === feed.feedId);
                    return (
                      <div
                        key={feed.feedId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '12px',
                          gap: '12px',
                          borderBottom: '1px solid var(--border-color)',
                          opacity: alreadyInCatalog ? 0.5 : 1
                        }}
                      >
                        <span style={{
                          fontSize: '20px',
                          width: '32px',
                          textAlign: 'center'
                        }}>
                          {feed.medium === 'video' ? '🎬' : '🎵'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 500, display: 'block' }}>{feed.title || 'Untitled Feed'}</span>
                          {feed.author && (
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{feed.author}</span>
                          )}
                        </div>
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: feed.medium === 'video' ? 'rgba(139, 92, 246, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: feed.medium === 'video' ? '#a78bfa' : '#60a5fa'
                        }}>
                          {feed.medium || 'music'}
                        </span>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleAddFromMyFeeds(feed)}
                          disabled={alreadyInCatalog}
                          style={{ padding: '6px 16px' }}
                        >
                          {alreadyInCatalog ? 'Added' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
    </Section>
  );
}
