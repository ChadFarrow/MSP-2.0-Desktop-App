import { useState, useEffect, useCallback } from 'react';
import { listFeedsLocal, loadFeedLocal, formatFeedDate } from '../utils/localFeedStorage';
import type { FeedSummary } from '../utils/localFeedStorage';

interface FeedSidebarProps {
  isOpen: boolean;
  onLoadFeed: (xml: string, id: string, feedType: 'album' | 'video' | 'publisher') => void;
  currentFeedId: string | undefined;
  refreshKey?: number;
}

export function FeedSidebar({ isOpen, onLoadFeed, currentFeedId, refreshKey }: FeedSidebarProps) {
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const refreshFeeds = useCallback(async () => {
    try {
      setError(null);
      const list = await listFeedsLocal();
      // Sort by most recently updated first
      list.sort((a, b) => b.updated_at - a.updated_at);
      setFeeds(list);
    } catch (err) {
      setError('Failed to load feeds');
      console.error('FeedSidebar: listFeedsLocal error', err);
    }
  }, []);

  // Load feeds on mount, when sidebar opens, or when refreshKey changes
  useEffect(() => {
    if (isOpen) {
      refreshFeeds();
    }
  }, [isOpen, refreshKey, refreshFeeds]);

  const handleClick = async (feed: FeedSummary) => {
    if (loadingId) return;
    setLoadingId(feed.id);
    try {
      const fullFeed = await loadFeedLocal(feed.id);
      onLoadFeed(fullFeed.xml, fullFeed.id, fullFeed.feed_type);
    } catch (err) {
      console.error('FeedSidebar: loadFeedLocal error', err);
      alert('Failed to load feed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className={`feed-sidebar${isOpen ? ' open' : ''}`}>
      <div className="feed-sidebar-header">
        <h3>Local Feeds</h3>
      </div>
      <div className="feed-sidebar-list">
        {error && <div className="feed-sidebar-error">{error}</div>}
        {!error && feeds.length === 0 && (
          <div className="feed-sidebar-empty">
            No local feeds yet. Save a feed to see it here.
          </div>
        )}
        {feeds.map((feed) => (
          <div
            key={feed.id}
            className={`feed-sidebar-item${feed.id === currentFeedId ? ' active' : ''}`}
            onClick={() => handleClick(feed)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(feed); }}
          >
            <span className="feed-sidebar-item-title">
              {loadingId === feed.id ? 'Loading...' : (feed.title || 'Untitled')}
            </span>
            <div className="feed-sidebar-item-meta">
              <span className={`feed-sidebar-type ${feed.feed_type}`}>
                {feed.feed_type}
              </span>
              <span className="feed-sidebar-date">
                {formatFeedDate(feed.updated_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
