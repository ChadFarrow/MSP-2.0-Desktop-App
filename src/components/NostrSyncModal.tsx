import { useState, useEffect } from 'react';
import type { Album } from '../types/feed';
import type { SavedAlbumInfo } from '../types/nostr';
import { saveAlbumToNostr, loadAlbumsFromNostr, loadAlbumByDTag } from '../utils/nostrSync';

interface NostrSyncModalProps {
  onClose: () => void;
  album: Album;
  isDirty: boolean;
  onLoadAlbum: (album: Album) => void;
}

export function NostrSyncModal({ onClose, album, isDirty, onLoadAlbum }: NostrSyncModalProps) {
  const [mode, setMode] = useState<'save' | 'load'>('save');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbumInfo[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);

  // Load saved albums when switching to load tab
  useEffect(() => {
    if (mode === 'load') {
      fetchSavedAlbums();
    }
  }, [mode]);

  const fetchSavedAlbums = async () => {
    setLoadingAlbums(true);
    setMessage(null);
    const result = await loadAlbumsFromNostr();
    setLoadingAlbums(false);

    if (result.success) {
      setSavedAlbums(result.albums);
      if (result.albums.length === 0) {
        setMessage({ type: 'success', text: 'No saved albums found on Nostr' });
      }
    } else {
      setMessage({ type: 'error', text: result.message });
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);

    const result = await saveAlbumToNostr(album, isDirty);
    setLoading(false);

    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.message
    });
  };

  const handleLoadAlbum = async (dTag: string) => {
    setLoading(true);
    setMessage(null);

    const result = await loadAlbumByDTag(dTag);
    setLoading(false);

    if (result.success && result.album) {
      onLoadAlbum(result.album);
      onClose();
    } else {
      setMessage({ type: 'error', text: result.message });
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nostr Sync</h2>
          <button className="btn btn-icon" onClick={onClose}>&#10005;</button>
        </div>
        <div className="modal-content">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`btn ${mode === 'save' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('save')}
            >
              Save to Nostr
            </button>
            <button
              className={`btn ${mode === 'load' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('load')}
            >
              Load from Nostr
            </button>
          </div>

          {mode === 'save' ? (
            <div className="nostr-save-section">
              <div className="nostr-album-preview">
                <h3>{album.title || 'Untitled Album'}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {album.author || 'No author'} &bull; {album.tracks.length} track{album.tracks.length !== 1 ? 's' : ''}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '8px' }}>
                  ID: {album.podcastGuid}
                </p>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
                This will save your album data to Nostr relays, signed with your Nostr key.
                You can load it later on any device where you sign in with the same key.
              </p>
            </div>
          ) : (
            <div className="nostr-load-section">
              {loadingAlbums ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  Loading saved albums...
                </div>
              ) : savedAlbums.length > 0 ? (
                <div className="nostr-album-list">
                  {savedAlbums.map((savedAlbum) => (
                    <div
                      key={savedAlbum.id}
                      className="nostr-album-item"
                      onClick={() => !loading && handleLoadAlbum(savedAlbum.dTag)}
                    >
                      <div className="nostr-album-item-title">{savedAlbum.title}</div>
                      <div className="nostr-album-item-date">{formatDate(savedAlbum.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  No saved albums found
                </div>
              )}
            </div>
          )}

          {message && (
            <div style={{
              color: message.type === 'error' ? 'var(--error)' : 'var(--success)',
              marginTop: '12px',
              fontSize: '0.875rem'
            }}>
              {message.text}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {mode === 'save' && (
            <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
              {loading ? 'Saving...' : 'Save to Nostr'}
            </button>
          )}
          {mode === 'load' && (
            <button className="btn btn-secondary" onClick={fetchSavedAlbums} disabled={loadingAlbums}>
              {loadingAlbums ? 'Loading...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
