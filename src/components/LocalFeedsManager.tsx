/**
 * Local Feeds Manager Component
 * 
 * Shows all locally stored feeds and allows loading/deleting them.
 * Desktop-only component (won't render in web).
 */

import { useState, useEffect } from 'react';
import {
  listFeedsLocal,
  loadFeedLocal,
  deleteFeedLocal,
  getFeedsDirectory,
  hasLocalStorage,
  formatFeedDate,
  type FeedSummary,
} from '../utils/localFeedStorage';
import { extractErrorMessage } from '../utils/errorHandling';

interface LocalFeedsManagerProps {
  onLoadFeed: (xml: string, id: string, feedType: 'album' | 'publisher') => void;
}

export function LocalFeedsManager({ onLoadFeed }: LocalFeedsManagerProps) {
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedsDir, setFeedsDir] = useState<string>('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Load feeds on mount
  useEffect(() => {
    if (!hasLocalStorage()) return;
    
    loadFeeds();
    getFeedsDirectory().then(setFeedsDir).catch(console.error);
  }, []);

  const loadFeeds = async () => {
    try {
      setLoading(true);
      setError(null);
      const list = await listFeedsLocal();
      setFeeds(list);
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to load feeds'));
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (feed: FeedSummary) => {
    try {
      const fullFeed = await loadFeedLocal(feed.id);
      onLoadFeed(fullFeed.xml, fullFeed.id, fullFeed.feed_type as 'album' | 'publisher');
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to load feed'));
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }

    try {
      await deleteFeedLocal(id);
      setFeeds(feeds.filter(f => f.id !== id));
      setDeleteConfirm(null);
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to delete feed'));
    }
  };

  // Don't render in web mode
  if (!hasLocalStorage()) {
    return null;
  }

  return (
    <div className="local-feeds-manager">
      <div className="lfm-header">
        <h3>📁 Local Feeds</h3>
        <button onClick={loadFeeds} className="refresh-btn" title="Refresh">
          ↻
        </button>
      </div>

      {error && <div className="lfm-error">{error}</div>}

      {loading ? (
        <div className="lfm-loading">Loading...</div>
      ) : feeds.length === 0 ? (
        <div className="lfm-empty">
          <p>No local feeds yet.</p>
          <p className="lfm-hint">Save a feed to store it on your computer.</p>
        </div>
      ) : (
        <ul className="lfm-list">
          {feeds.map(feed => (
            <li key={feed.id} className="lfm-item">
              <div className="lfm-item-info">
                <span className="lfm-title">{feed.title || 'Untitled'}</span>
                <span className="lfm-meta">
                  <span className={`lfm-type lfm-type-${feed.feed_type}`}>
                    {feed.feed_type}
                  </span>
                  <span className="lfm-date">{formatFeedDate(feed.updated_at)}</span>
                </span>
              </div>
              <div className="lfm-item-actions">
                <button onClick={() => handleLoad(feed)} className="load-btn">
                  Load
                </button>
                <button 
                  onClick={() => handleDelete(feed.id)} 
                  className={`delete-btn ${deleteConfirm === feed.id ? 'confirm' : ''}`}
                >
                  {deleteConfirm === feed.id ? 'Confirm?' : '×'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {feedsDir && (
        <div className="lfm-footer">
          <small title={feedsDir}>📂 {feedsDir.split('/').slice(-2).join('/')}</small>
        </div>
      )}
    </div>
  );
}

// CSS styles
export const localFeedsStyles = `
.local-feeds-manager {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
  background: #fafafa;
}

.lfm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.lfm-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.refresh-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
}

.refresh-btn:hover {
  background: #e0e0e0;
}

.lfm-error {
  color: #e74c3c;
  padding: 0.5rem;
  background: #fdeaea;
  border-radius: 4px;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}

.lfm-loading,
.lfm-empty {
  text-align: center;
  padding: 1rem;
  color: #666;
}

.lfm-hint {
  font-size: 0.85rem;
  color: #999;
}

.lfm-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.lfm-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
}

.lfm-item:last-child {
  border-bottom: none;
}

.lfm-item:hover {
  background: #f5f5f5;
}

.lfm-item-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.lfm-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lfm-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #888;
}

.lfm-type {
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.lfm-type-album {
  background: #e8f4fd;
  color: #2980b9;
}

.lfm-type-publisher {
  background: #f0e8fd;
  color: #8e44ad;
}

.lfm-item-actions {
  display: flex;
  gap: 0.5rem;
}

.lfm-item-actions button {
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.load-btn {
  background: #3498db;
  color: white;
}

.load-btn:hover {
  background: #2980b9;
}

.delete-btn {
  background: #e0e0e0;
  color: #666;
  min-width: 28px;
}

.delete-btn:hover {
  background: #e74c3c;
  color: white;
}

.delete-btn.confirm {
  background: #e74c3c;
  color: white;
  min-width: auto;
  padding: 0.25rem 0.75rem;
}

.lfm-footer {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid #eee;
  color: #999;
}

.lfm-footer small {
  font-family: monospace;
  font-size: 0.7rem;
}
`;
