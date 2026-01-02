import { useState } from 'react';
import { fetchFeedFromUrl } from '../../utils/xmlParser';
import { loadAlbumsFromNostr, loadAlbumByDTag, fetchNostrMusicTracks, groupTracksByAlbum } from '../../utils/nostrSync';
import { convertNostrMusicToAlbum, parseNostrEventJson } from '../../utils/nostrMusicConverter';
import { buildHostedUrl, type HostedFeedInfo } from '../../utils/hostedFeed';
import type { SavedAlbumInfo, NostrMusicAlbumGroup } from '../../types/nostr';
import type { Album } from '../../types/feed';

interface ImportModalProps {
  onClose: () => void;
  onImport: (xml: string) => void;
  onLoadAlbum: (album: Album) => void;
  isLoggedIn: boolean;
}

export function ImportModal({ onClose, onImport, onLoadAlbum, isLoggedIn }: ImportModalProps) {
  const [mode, setMode] = useState<'file' | 'paste' | 'url' | 'nostr' | 'nostrMusic' | 'nostrEvent' | 'hosted'>('file');
  const [xmlContent, setXmlContent] = useState('');
  const [jsonContent, setJsonContent] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbumInfo[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [musicAlbums, setMusicAlbums] = useState<NostrMusicAlbumGroup[]>([]);
  const [loadingMusic, setLoadingMusic] = useState(false);
  const [hostedFeedId, setHostedFeedId] = useState('');
  const [hostedToken, setHostedToken] = useState('');

  const fetchSavedAlbums = async () => {
    setLoadingAlbums(true);
    setError('');
    const result = await loadAlbumsFromNostr();
    setLoadingAlbums(false);

    if (result.success) {
      setSavedAlbums(result.albums);
      if (result.albums.length === 0) {
        setError('No saved albums found on Nostr');
      }
    } else {
      setError(result.message);
    }
  };

  const handleLoadFromNostr = async (dTag: string) => {
    setLoading(true);
    setError('');

    const result = await loadAlbumByDTag(dTag);
    setLoading(false);

    if (result.success && result.album) {
      onLoadAlbum(result.album);
      onClose();
    } else {
      setError(result.message);
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

  const fetchMusicTracks = async () => {
    setLoadingMusic(true);
    setError('');

    const result = await fetchNostrMusicTracks();
    setLoadingMusic(false);

    if (result.success) {
      const grouped = groupTracksByAlbum(result.tracks);
      setMusicAlbums(grouped);
      if (grouped.length === 0) {
        setError('No music tracks found on Nostr');
      }
    } else {
      setError(result.message);
    }
  };

  const handleImportMusicAlbum = async (albumGroup: NostrMusicAlbumGroup) => {
    setLoading(true);
    setError('');

    try {
      const album = await convertNostrMusicToAlbum(albumGroup, true);
      onLoadAlbum(album);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert music tracks');
      setLoading(false);
    }
  };

  const handleImportNostrEvent = async () => {
    setLoading(true);
    setError('');

    try {
      if (!jsonContent.trim()) {
        throw new Error('No JSON content provided');
      }

      const album = await parseNostrEventJson(jsonContent, true);
      onLoadAlbum(album);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse Nostr event');
      setLoading(false);
    }
  };

  const handleImportHosted = async () => {
    if (!hostedFeedId.trim()) {
      setError('Please enter a Feed ID');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Fetch the feed XML (public, no auth needed)
      const feedUrl = buildHostedUrl(hostedFeedId.trim());
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new Error('Feed not found');
      }
      const xml = await response.text();

      // If token provided, save credentials for later editing
      if (hostedToken.trim()) {
        const newInfo: HostedFeedInfo = {
          feedId: hostedFeedId.trim(),
          editToken: hostedToken.trim(),
          createdAt: Date.now(),
          lastUpdated: Date.now()
        };
        // Store as pending - will be associated with the album's GUID after import
        localStorage.setItem('msp2-pending-hosted', JSON.stringify(newInfo));
      }

      onImport(xml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import hosted feed');
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setXmlContent(content);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setError('');
    setLoading(true);

    try {
      let xml = xmlContent;

      if (mode === 'url') {
        xml = await fetchFeedFromUrl(feedUrl);
      }

      if (!xml.trim()) {
        throw new Error('No XML content provided');
      }

      onImport(xml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import feed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Feed</h2>
          <button className="btn btn-icon" onClick={onClose}>&#10005;</button>
        </div>
        <div className="modal-content">
          <div className="import-mode-buttons" style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('file')}
            >
              Upload File
            </button>
            <button
              className={`btn ${mode === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('paste')}
            >
              Paste XML
            </button>
            <button
              className={`btn ${mode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('url')}
            >
              From URL
            </button>
            <button
              className={`btn ${mode === 'nostrEvent' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('nostrEvent')}
            >
              Nostr Event
            </button>
            <button
              className={`btn ${mode === 'hosted' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('hosted')}
            >
              From MSP Hosted
            </button>
            {isLoggedIn && (
              <>
                <button
                  className={`btn ${mode === 'nostr' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setMode('nostr'); fetchSavedAlbums(); }}
                >
                  From Nostr
                </button>
                <button
                  className={`btn ${mode === 'nostrMusic' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setMode('nostrMusic'); fetchMusicTracks(); }}
                >
                  From Nostr Music
                </button>
              </>
            )}
          </div>

          {mode === 'nostrMusic' ? (
            <div className="nostr-music-section">
              {loadingMusic ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  Loading music from Nostr...
                </div>
              ) : musicAlbums.length > 0 ? (
                <div className="nostr-album-list">
                  {musicAlbums.map((albumGroup, index) => (
                    <div
                      key={`${albumGroup.albumName}-${albumGroup.artist}-${index}`}
                      className="nostr-music-album-item"
                      onClick={() => !loading && handleImportMusicAlbum(albumGroup)}
                      style={{ cursor: loading ? 'wait' : 'pointer' }}
                    >
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        {albumGroup.imageUrl && (
                          <img
                            src={albumGroup.imageUrl}
                            alt={albumGroup.albumName}
                            style={{ width: '48px', height: '48px', borderRadius: '4px', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="nostr-album-item-title">{albumGroup.albumName}</div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            {albumGroup.artist}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {albumGroup.tracks.length} track{albumGroup.tracks.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  {error || 'No music tracks found'}
                </div>
              )}
            </div>
          ) : mode === 'nostr' ? (
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
                      onClick={() => !loading && handleLoadFromNostr(savedAlbum.dTag)}
                    >
                      <div className="nostr-album-item-title">{savedAlbum.title}</div>
                      <div className="nostr-album-item-date">{formatDate(savedAlbum.createdAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  {error || 'No saved albums found'}
                </div>
              )}
            </div>
          ) : mode === 'file' ? (
            <div className="form-group">
              <label className="form-label">Select XML File</label>
              <input
                type="file"
                accept=".xml,application/xml,text/xml"
                onChange={handleFileChange}
                style={{ marginBottom: '12px' }}
              />
              {fileName && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Selected: {fileName}
                </div>
              )}
            </div>
          ) : mode === 'paste' ? (
            <div className="form-group">
              <label className="form-label">Paste RSS XML</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: '200px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                placeholder="Paste your RSS feed XML here..."
                value={xmlContent}
                onChange={e => setXmlContent(e.target.value)}
              />
            </div>
          ) : mode === 'nostrEvent' ? (
            <div className="form-group">
              <label className="form-label">Paste Nostr Event JSON (kind 36787)</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: '200px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                placeholder='{"kind": 36787, "content": "...", "tags": [...], ...}'
                value={jsonContent}
                onChange={e => setJsonContent(e.target.value)}
              />
            </div>
          ) : mode === 'hosted' ? (
            <div className="form-group">
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                Import a feed hosted on MSP. Enter the Feed ID from your feed URL.
              </p>
              <label className="form-label">Feed ID</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. ZiagqOqCluAv"
                value={hostedFeedId}
                onChange={e => setHostedFeedId(e.target.value)}
                style={{ fontFamily: 'monospace', marginBottom: '12px' }}
              />
              <label className="form-label">Edit Token (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Your saved edit token"
                value={hostedToken}
                onChange={e => setHostedToken(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '8px' }}>
                If you have your edit token, enter it to enable editing after import.
              </p>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Feed URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/feed.xml"
                value={feedUrl}
                onChange={e => setFeedUrl(e.target.value)}
              />
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--error)', marginTop: '12px', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {mode === 'nostrMusic' ? (
            <button className="btn btn-secondary" onClick={fetchMusicTracks} disabled={loadingMusic}>
              {loadingMusic ? 'Loading...' : 'Refresh'}
            </button>
          ) : mode === 'nostr' ? (
            <button className="btn btn-secondary" onClick={fetchSavedAlbums} disabled={loadingAlbums}>
              {loadingAlbums ? 'Loading...' : 'Refresh'}
            </button>
          ) : mode === 'nostrEvent' ? (
            <button className="btn btn-primary" onClick={handleImportNostrEvent} disabled={loading}>
              {loading ? 'Importing...' : 'Import Event'}
            </button>
          ) : mode === 'hosted' ? (
            <button className="btn btn-primary" onClick={handleImportHosted} disabled={loading}>
              {loading ? 'Importing...' : 'Import Hosted'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
              {loading ? 'Importing...' : 'Import Feed'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
