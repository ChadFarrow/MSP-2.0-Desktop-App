import { useState } from 'react';
import { fetchFeedFromUrl } from '../../utils/xmlParser';
import { loadAlbumsFromNostr, loadAlbumByDTag, fetchNostrMusicTracks, groupTracksByAlbum } from '../../utils/nostrSync';
import { convertNostrMusicToAlbum, parseNostrEventJson } from '../../utils/nostrMusicConverter';
import { buildHostedUrl, type HostedFeedInfo } from '../../utils/hostedFeed';
import { pendingHostedStorage } from '../../utils/storage';
import { formatTimestamp } from '../../utils/dateUtils';
import type { SavedAlbumInfo, NostrMusicAlbumGroup } from '../../types/nostr';
import type { Album } from '../../types/feed';
import { ModalWrapper } from './ModalWrapper';

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
  const [showHelp, setShowHelp] = useState(false);

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

    if (result.success && result.album) {
      onClose();
      onLoadAlbum(result.album);
    } else {
      setLoading(false);
      setError(result.message);
    }
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
      onClose();
      onLoadAlbum(album);
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
        pendingHostedStorage.save(newInfo);
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
    <>
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Import Feed
            <span
              className="import-help-icon"
              onClick={() => setShowHelp(true)}
              title="Show import type descriptions"
            >
              ℹ️
            </span>
          </div>
        }
        footer={
          <div style={{ display: 'flex', gap: '12px' }}>
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
        }
      >
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label">Import Source</label>
            <select
              className="form-select"
              value={mode}
              onChange={(e) => {
                const newMode = e.target.value as typeof mode;
                setMode(newMode);
                if (newMode === 'nostr') fetchSavedAlbums();
                if (newMode === 'nostrMusic') fetchMusicTracks();
              }}
            >
              <option value="file">Upload File</option>
              <option value="paste">Paste XML</option>
              <option value="url">From URL</option>
              <option value="nostrEvent">Nostr Event</option>
              <option value="hosted">MSP Hosted</option>
              {isLoggedIn && <option value="nostr">From Nostr</option>}
              {isLoggedIn && <option value="nostrMusic">From Nostr Music</option>}
            </select>
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
                      <div className="nostr-album-item-date">{formatTimestamp(savedAlbum.createdAt)}</div>
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
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'var(--primary-color)';
                  e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.1)';
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    setFileName(file.name);
                    setError('');
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      setXmlContent(event.target?.result as string);
                    };
                    reader.onerror = () => setError('Failed to read file');
                    reader.readAsText(file);
                  }
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px 20px',
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-tertiary)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background-color 0.2s'
                }}
              >
                <span style={{ fontSize: '2rem', marginBottom: '12px' }}>📄</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {fileName || 'Drop XML file here'}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  or click to select
                </span>
                <input
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>
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
                Import a feed hosted on MSP. Upload your backup file or enter details manually.
              </p>

              {/* Upload backup file */}
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '20px',
                  marginBottom: '16px',
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-tertiary)',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s'
                }}
              >
                <span style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📁</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Upload Backup File
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Click to select your .json backup file
                </span>
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const json = JSON.parse(event.target?.result as string);
                        const feedId = json.feedId || json.feed_id || json.msp_hosted_feed_backup?.feed_id;
                        const token = json.editToken || json.edit_token || json.msp_hosted_feed_backup?.edit_token;
                        if (feedId) {
                          setHostedFeedId(feedId);
                          if (token) setHostedToken(token);
                          setError('');
                        } else {
                          setError('Invalid backup file format');
                        }
                      } catch {
                        setError('Could not parse backup file');
                      }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />
              </label>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>OR ENTER MANUALLY</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
              </div>

              <label className="form-label">Feed ID</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 95761582-a064-4430-8192-4571d8d3715b"
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
        </ModalWrapper>

      {showHelp && (
        <ModalWrapper
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          title="Import Types"
          className="import-help-modal"
          style={{ zIndex: 1001 }}
          footer={
            <button className="btn btn-primary" onClick={() => setShowHelp(false)}>Got it</button>
          }
        >
          <ul className="import-help-list">
                <li><strong>Upload File</strong> - Upload an RSS/XML feed file from your device</li>
                <li><strong>Paste XML</strong> - Paste RSS/XML content directly</li>
                <li><strong>From URL</strong> - Fetch a feed from any URL</li>
                <li><strong>Nostr Event</strong> - Import from a Nostr Event (kind 36787)</li>
                <li><strong>MSP Hosted</strong> - Load a feed hosted on MSP servers using its Feed ID</li>
                <li><strong>From Nostr</strong> - Load your previously saved albums from Nostr (requires login)</li>
                <li><strong>From Nostr Music</strong> - Import tracks from Nostr Music library (requires login)</li>
              </ul>
            </ModalWrapper>
      )}
    </>
  );
}
