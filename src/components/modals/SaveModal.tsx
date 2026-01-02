import { useState, useEffect } from 'react';
import { generateRssFeed, downloadXml, copyToClipboard } from '../../utils/xmlGenerator';
import { saveAlbumToNostr, publishNostrMusicTracks, uploadToBlossom } from '../../utils/nostrSync';
import type { PublishProgress } from '../../utils/nostrSync';
import type { Album } from '../../types/feed';
import {
  getHostedFeedInfo,
  saveHostedFeedInfo,
  clearHostedFeedInfo,
  createHostedFeed,
  updateHostedFeed,
  buildHostedUrl,
  type HostedFeedInfo
} from '../../utils/hostedFeed';

const DEFAULT_BLOSSOM_SERVER = 'https://podtards.com';

interface SaveModalProps {
  onClose: () => void;
  album: Album;
  isDirty: boolean;
  isLoggedIn: boolean;
  onImport?: (xml: string) => void;
}

export function SaveModal({ onClose, album, isDirty, isLoggedIn, onImport }: SaveModalProps) {
  const [mode, setMode] = useState<'local' | 'download' | 'clipboard' | 'nostr' | 'nostrMusic' | 'blossom' | 'hosted'>('local');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [blossomServer, setBlossomServer] = useState(DEFAULT_BLOSSOM_SERVER);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [stableUrl, setStableUrl] = useState<string | null>(null);
  const [hostedInfo, setHostedInfo] = useState<HostedFeedInfo | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [showEditToken, setShowEditToken] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreFeedId, setRestoreFeedId] = useState('');
  const [restoreToken, setRestoreToken] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);

  // Check for existing hosted feed on mount, and apply pending credentials
  useEffect(() => {
    // Check for pending credentials from import
    const pendingStr = localStorage.getItem('msp2-pending-hosted');
    if (pendingStr) {
      try {
        const pending = JSON.parse(pendingStr) as HostedFeedInfo;
        saveHostedFeedInfo(album.podcastGuid, pending);
        localStorage.removeItem('msp2-pending-hosted');
        setHostedInfo(pending);
        setHostedUrl(buildHostedUrl(pending.feedId));
        return;
      } catch {
        localStorage.removeItem('msp2-pending-hosted');
      }
    }

    const info = getHostedFeedInfo(album.podcastGuid);
    if (info) {
      setHostedInfo(info);
      setHostedUrl(buildHostedUrl(info.feedId));
    }
  }, [album.podcastGuid]);

  // Restore feed credentials from saved token
  const handleRestore = async () => {
    if (!restoreFeedId.trim() || !restoreToken.trim()) {
      setMessage({ type: 'error', text: 'Please enter both Feed ID and Edit Token' });
      return;
    }

    setRestoreLoading(true);
    setMessage(null);

    try {
      // Try to update the feed with the provided credentials to verify they work
      const xml = generateRssFeed(album);
      await updateHostedFeed(restoreFeedId.trim(), restoreToken.trim(), xml, album.title);

      // Credentials work - save them
      const newInfo: HostedFeedInfo = {
        feedId: restoreFeedId.trim(),
        editToken: restoreToken.trim(),
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      saveHostedFeedInfo(album.podcastGuid, newInfo);
      setHostedInfo(newInfo);
      setHostedUrl(buildHostedUrl(restoreFeedId.trim()));
      setShowRestore(false);
      setRestoreFeedId('');
      setRestoreToken('');
      setMessage({ type: 'success', text: 'Feed restored and updated!' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Invalid credentials' });
    } finally {
      setRestoreLoading(false);
    }
  };

  // Import feed content and restore credentials
  const handleImportAndRestore = async () => {
    if (!restoreFeedId.trim() || !restoreToken.trim()) {
      setMessage({ type: 'error', text: 'Please enter both Feed ID and Edit Token' });
      return;
    }

    if (!onImport) {
      setMessage({ type: 'error', text: 'Import not available' });
      return;
    }

    setRestoreLoading(true);
    setMessage(null);

    try {
      // Fetch the feed XML (public, no auth needed)
      const feedUrl = buildHostedUrl(restoreFeedId.trim());
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new Error('Feed not found');
      }
      const xml = await response.text();

      // Verify the token works by doing a test (we'll update after import)
      // For now just save the credentials - they'll be validated on next save
      const newInfo: HostedFeedInfo = {
        feedId: restoreFeedId.trim(),
        editToken: restoreToken.trim(),
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };

      // Import the feed content
      onImport(xml);

      // Save credentials (using the imported feed's podcastGuid will happen after import)
      // Store with a temporary key, will be updated when user saves
      localStorage.setItem('msp2-pending-hosted', JSON.stringify(newInfo));

      setShowRestore(false);
      setRestoreFeedId('');
      setRestoreToken('');
      onClose();
      setMessage({ type: 'success', text: 'Feed imported! Save to verify your token.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to import feed' });
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    setProgress(null);

    try {
      switch (mode) {
        case 'local':
          localStorage.setItem('msp2-album-data', JSON.stringify(album));
          setMessage({ type: 'success', text: 'Saved to browser storage' });
          break;
        case 'download':
          const xml = generateRssFeed(album);
          const filename = `${album.title || 'feed'}.xml`.replace(/[^a-z0-9.-]/gi, '_');
          downloadXml(xml, filename);
          setMessage({ type: 'success', text: 'Download started' });
          break;
        case 'clipboard':
          const xmlContent = generateRssFeed(album);
          await copyToClipboard(xmlContent);
          setMessage({ type: 'success', text: 'Copied to clipboard' });
          break;
        case 'nostr':
          const result = await saveAlbumToNostr(album, isDirty);
          setMessage({
            type: result.success ? 'success' : 'error',
            text: result.message
          });
          break;
        case 'nostrMusic':
          const musicResult = await publishNostrMusicTracks(album, undefined, setProgress);
          setProgress(null);
          setMessage({
            type: musicResult.success ? 'success' : 'error',
            text: musicResult.message
          });
          break;
        case 'blossom':
          const blossomResult = await uploadToBlossom(album, blossomServer);
          if (blossomResult.success) {
            if (blossomResult.url) {
              setFeedUrl(blossomResult.url);
            }
            if (blossomResult.stableUrl) {
              setStableUrl(blossomResult.stableUrl);
            }
          }
          setMessage({
            type: blossomResult.success ? 'success' : 'error',
            text: blossomResult.message
          });
          break;
        case 'hosted':
          const hostedXml = generateRssFeed(album);
          if (hostedInfo) {
            // Update existing feed
            await updateHostedFeed(hostedInfo.feedId, hostedInfo.editToken, hostedXml, album.title);
            const updatedInfo = { ...hostedInfo, lastUpdated: Date.now() };
            saveHostedFeedInfo(album.podcastGuid, updatedInfo);
            setHostedInfo(updatedInfo);
            setMessage({ type: 'success', text: 'Feed updated!' });
          } else {
            // Create new feed
            const hostedResult = await createHostedFeed(hostedXml, album.title, album.podcastGuid);
            const newInfo: HostedFeedInfo = {
              feedId: hostedResult.feedId,
              editToken: hostedResult.editToken,
              createdAt: Date.now(),
              lastUpdated: Date.now()
            };
            saveHostedFeedInfo(album.podcastGuid, newInfo);
            setHostedInfo(newInfo);
            setHostedUrl(hostedResult.url);
            setShowEditToken(hostedResult.editToken); // Show token so user can save it
            setMessage({ type: 'success', text: 'Feed created! Save your edit token below.' });
          }
          break;
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Save Feed</h2>
          <button className="btn btn-icon" onClick={onClose}>&#10005;</button>
        </div>
        <div className="modal-content">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${mode === 'local' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('local')}
            >
              Local Storage
            </button>
            <button
              className={`btn ${mode === 'download' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('download')}
            >
              Download XML
            </button>
            <button
              className={`btn ${mode === 'clipboard' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('clipboard')}
            >
              Copy to Clipboard
            </button>
            <button
              className={`btn ${mode === 'hosted' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode('hosted')}
            >
              Host on MSP
            </button>
            {isLoggedIn && (
              <button
                className={`btn ${mode === 'nostr' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('nostr')}
              >
                Save to Nostr
              </button>
            )}
            {isLoggedIn && (
              <button
                className={`btn ${mode === 'nostrMusic' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('nostrMusic')}
              >
                Publish Nostr Music
              </button>
            )}
            {isLoggedIn && (
              <button
                className={`btn ${mode === 'blossom' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('blossom')}
              >
                Publish to Blossom
              </button>
            )}
          </div>

          <div className="nostr-album-preview">
            <h3>{album.title || 'Untitled Album'}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {album.author || 'No author'} &bull; {album.tracks.length} track{album.tracks.length !== 1 ? 's' : ''}
            </p>
          </div>

          {mode === 'local' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
              Save to your browser's local storage. Data persists until you clear browser data.
            </p>
          )}
          {mode === 'download' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
              Download the RSS feed as an XML file to your computer.
            </p>
          )}
          {mode === 'clipboard' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
              Copy the RSS XML to your clipboard for pasting elsewhere.
            </p>
          )}
          {mode === 'nostr' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
              Publish your feed to Nostr relays. Load it later on any device with your Nostr key.
            </p>
          )}
          {mode === 'nostrMusic' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '16px' }}>
              Publish each track as a Nostr Music event (kind 36787). Compatible with Nostr music clients.
            </p>
          )}
          {mode === 'blossom' && (
            <div style={{ marginTop: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                Upload your RSS feed to a Blossom server. Get a permanent URL for podcast apps.
              </p>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem' }}>
                Blossom Server URL
              </label>
              <input
                type="text"
                value={blossomServer}
                onChange={(e) => setBlossomServer(e.target.value)}
                placeholder="https://blossom.example.com"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem'
                }}
              />
              {feedUrl && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Direct Blossom URL (changes with each update)
                  </label>
                  <input
                    type="text"
                    value={feedUrl}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              )}
              {stableUrl && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--success)' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                    Stable Feed URL (for podcast apps)
                  </label>
                  <input
                    type="text"
                    value={stableUrl}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--success)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace'
                    }}
                  />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '8px', marginBottom: '8px' }}>
                    Use this URL in Apple Podcasts, Spotify, etc. It always points to the latest version.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      navigator.clipboard.writeText(stableUrl);
                      setMessage({ type: 'success', text: 'Stable URL copied to clipboard' });
                    }}
                  >
                    Copy Stable URL
                  </button>
                </div>
              )}
            </div>
          )}
          {mode === 'hosted' && (
            <div style={{ marginTop: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                {hostedInfo
                  ? 'Your feed is already hosted. Click Save to update it with your latest changes.'
                  : 'Host your RSS feed on MSP. No account required - just save your edit token!'}
              </p>
              {hostedUrl && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--success)' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                    Your Feed URL
                  </label>
                  <input
                    type="text"
                    value={hostedUrl}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--success)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace'
                    }}
                  />
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '8px', marginBottom: '8px' }}>
                    Use this URL in Apple Podcasts, Spotify, etc. It always points to the latest version.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        navigator.clipboard.writeText(hostedUrl);
                        setMessage({ type: 'success', text: 'Feed URL copied to clipboard' });
                      }}
                    >
                      Copy URL
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => {
                        clearHostedFeedInfo(album.podcastGuid);
                        setHostedInfo(null);
                        setHostedUrl(null);
                        setShowEditToken(null);
                        setMessage({ type: 'success', text: 'Feed unlinked from this browser' });
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              )}
              {showEditToken && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--warning, #f59e0b)' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--warning, #f59e0b)' }}>
                    Your Edit Token (save this!)
                  </label>
                  <input
                    type="text"
                    value={showEditToken}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--warning, #f59e0b)',
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace'
                    }}
                  />
                  <p style={{ color: 'var(--warning, #f59e0b)', fontSize: '0.75rem', marginTop: '8px', marginBottom: '8px' }}>
                    Save this token somewhere safe! You'll need it to edit your feed from another browser or device.
                  </p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(showEditToken);
                      setMessage({ type: 'success', text: 'Edit token copied to clipboard' });
                    }}
                  >
                    Copy Token
                  </button>
                </div>
              )}
              {!hostedInfo && !showEditToken && (
                <div style={{ marginTop: '12px' }}>
                  <p style={{ color: 'var(--warning, #f59e0b)', fontSize: '0.75rem', padding: '8px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '4px', marginBottom: '12px' }}>
                    Your edit token will be saved in this browser. If you clear browser data, you won't be able to update this feed.
                  </p>
                  {!showRestore ? (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                      onClick={() => setShowRestore(true)}
                    >
                      Have a token? Restore existing feed
                    </button>
                  ) : (
                    <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Feed ID (from your feed URL)
                      </label>
                      <input
                        type="text"
                        value={restoreFeedId}
                        onChange={(e) => setRestoreFeedId(e.target.value)}
                        placeholder="e.g. ZiagqOqCluAv"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          marginBottom: '8px'
                        }}
                      />
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Edit Token
                      </label>
                      <input
                        type="text"
                        value={restoreToken}
                        onChange={(e) => setRestoreToken(e.target.value)}
                        placeholder="Your saved edit token"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          backgroundColor: 'var(--bg-secondary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          marginBottom: '12px'
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                          onClick={handleImportAndRestore}
                          disabled={restoreLoading}
                        >
                          {restoreLoading ? 'Loading...' : 'Import & Restore'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                          onClick={handleRestore}
                          disabled={restoreLoading}
                        >
                          Restore Only
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                          onClick={() => {
                            setShowRestore(false);
                            setRestoreFeedId('');
                            setRestoreToken('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginTop: '8px' }}>
                        <strong>Import & Restore</strong>: Fetches feed content and loads it into the editor<br />
                        <strong>Restore Only</strong>: Links credentials without changing current content
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {progress && (
            <div style={{ marginTop: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Publishing track {progress.current} of {progress.total}: {progress.trackTitle}
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
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading
              ? (mode === 'nostrMusic' || mode === 'blossom' || mode === 'hosted' ? 'Uploading...' : 'Saving...')
              : (mode === 'nostrMusic' ? 'Publish' : mode === 'blossom' || mode === 'hosted' ? 'Upload' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
