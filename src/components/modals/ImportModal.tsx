import { useState, useEffect } from 'react';
import { fetchFeedFromUrl } from '../../utils/xmlParser';
import { loadAlbumsFromNostr, loadAlbumByDTag, fetchNostrMusicTracks, groupTracksByAlbum } from '../../utils/nostrSync';
import { convertNostrMusicToAlbum, parseNostrEventJson } from '../../utils/nostrMusicConverter';
import { type HostedFeedInfo, buildHostedUrl } from '../../utils/hostedFeed';
import { fetchAdminFeeds, fetchEmailFeeds } from '../../utils/adminAuth';
import { isEmailLoggedIn, getEmailSession } from '../../utils/emailSession';
import { EmailLoginModal } from '../auth/EmailLoginModal';
import { SignInPrompt } from '../auth/SignInPrompt';
import { NostrConnectModal } from './NostrConnectModal';
import { pendingHostedStorage } from '../../utils/storage';
import { formatTimestamp } from '../../utils/dateUtils';
import { checkSignerConnection } from '../../utils/nostrSigner';
import { useNostr } from '../../store/nostrStore';
import { useExperimental } from '../../store/experimentalStore';
import type { SavedAlbumInfo, NostrMusicAlbumGroup } from '../../types/nostr';
import type { Album } from '../../types/feed';
import { ModalWrapper } from './ModalWrapper';

interface HostedFeedListItem {
  feedId: string;
  title?: string;
  author?: string;
  medium?: string;
  createdAt?: string;
  lastUpdated?: string;
  ownerPubkey?: string;
  ownerEmailHash?: string;
}

interface ImportModalProps {
  onClose: () => void;
  onImport: (xml: string, sourceUrl?: string) => void;
  onLoadAlbum: (album: Album) => void;
  isLoggedIn: boolean;
  templateMode?: boolean;
}

export function ImportModal({ onClose, onImport, onLoadAlbum, isLoggedIn, templateMode }: ImportModalProps) {
  const { state: nostrState } = useNostr();
  const { showExperimental } = useExperimental();
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
  const [hostedFeeds, setHostedFeeds] = useState<HostedFeedListItem[]>([]);
  const [loadingHostedFeeds, setLoadingHostedFeeds] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [showNostrConnect, setShowNostrConnect] = useState(false);
  // Manual Feed-ID / edit-token / backup entry is collapsed by default now that
  // signing in is the primary way to find your feeds — this is the "I have a token" path.
  const [showManualImport, setShowManualImport] = useState(false);

  // Reset mode if the current selection is an experimental option that just got hidden
  useEffect(() => {
    if (!showExperimental && (mode === 'nostr' || mode === 'nostrEvent')) {
      setMode('file');
    }
  }, [showExperimental, mode]);

  // Load the account's feeds when the MSP Hosted tab is active — fires on
  // switching to the tab (any sign-in type) and on Nostr sign-in while on it.
  // This is the single trigger for the tab switch; the select onChange must not
  // also call fetchHostedFeeds or Nostr users get two signer prompts. Email
  // sign-in while on the tab is handled by the EmailLoginModal onClose below
  // (isEmailLoggedIn() reads localStorage, so it can't be an effect dep).
  useEffect(() => {
    if (mode === 'hosted' && canListFeeds) fetchHostedFeeds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isLoggedIn]);

  const fetchSavedAlbums = async () => {
    const pubkey = nostrState.user?.pubkey;
    if (!pubkey) {
      setError('Not logged in to Nostr.');
      return;
    }
    setLoadingAlbums(true);
    setError('');
    const result = await loadAlbumsFromNostr(pubkey);
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

  const canListFeeds = isLoggedIn || isEmailLoggedIn();

  const fetchHostedFeeds = async () => {
    if (!canListFeeds) return;

    setLoadingHostedFeeds(true);
    setError('');

    try {
      let feeds: HostedFeedListItem[];
      if (isLoggedIn && nostrState.user?.pubkey) {
        const health = await checkSignerConnection();
        if (!health.connected) {
          setError(health.error ?? 'Nostr signer is not connected.');
          return;
        }
        const result = await fetchAdminFeeds();
        // Filter to only show feeds owned by the current user
        feeds = result.feeds.filter(
          (f: HostedFeedListItem) => f.ownerPubkey === nostrState.user?.pubkey
        );
      } else {
        // Email account: the server already scopes the list to this account.
        const result = await fetchEmailFeeds();
        feeds = result.feeds;
      }
      setHostedFeeds(feeds);
      if (feeds.length === 0) {
        setError('No hosted feeds found for your account');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch hosted feeds');
    } finally {
      setLoadingHostedFeeds(false);
    }
  };

  const handleLoadFromNostr = async (dTag: string) => {
    const pubkey = nostrState.user?.pubkey;
    if (!pubkey) {
      setError('Not logged in to Nostr.');
      return;
    }
    setLoading(true);
    setError('');

    const result = await loadAlbumByDTag(dTag, pubkey);

    if (result.success && result.album) {
      onClose();
      onLoadAlbum(result.album);
    } else {
      setLoading(false);
      setError(result.message);
    }
  };


  const fetchMusicTracks = async () => {
    const pubkey = nostrState.user?.pubkey;
    if (!pubkey) {
      setError('Not logged in to Nostr.');
      return;
    }
    setLoadingMusic(true);
    setError('');

    const result = await fetchNostrMusicTracks(pubkey);
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
      // Fetch the feed XML using relative URL (works on localhost and production)
      const response = await fetch(`/api/hosted/${hostedFeedId.trim()}.xml`);
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

      // Pass the hosted URL as source URL
      onImport(xml, buildHostedUrl(hostedFeedId.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import hosted feed');
      setLoading(false);
    }
  };

  const handleImportHostedFeed = async (feed: HostedFeedListItem) => {
    setLoading(true);
    setError('');

    try {
      // Fetch using relative URL (works on localhost and production)
      const response = await fetch(`/api/hosted/${feed.feedId}.xml`);
      if (!response.ok) {
        throw new Error('Feed not found');
      }
      const xml = await response.text();

      // Store feed info as pending (owned via Nostr or email, no token needed)
      const newInfo: HostedFeedInfo = {
        feedId: feed.feedId,
        editToken: '', // No token needed - owned via linked identity
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      if (feed.ownerPubkey) {
        newInfo.ownerPubkey = feed.ownerPubkey;
        newInfo.linkedAt = Date.now();
      }
      const emailHash = feed.ownerEmailHash ?? getEmailSession()?.emailHash;
      if (emailHash) {
        newInfo.ownerEmailHash = emailHash;
        newInfo.emailLinkedAt = Date.now();
      }
      pendingHostedStorage.save(newInfo);

      // Pass the hosted URL as source URL
      onImport(xml, buildHostedUrl(feed.feedId));
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

      // Pass source URL when importing from URL mode
      onImport(xml, mode === 'url' ? feedUrl : undefined);
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
            {templateMode ? 'Import Feed as Template' : 'Import Feed'}
            <span
              className="import-help-icon"
              onClick={() => setShowHelp(true)}
              title="Show import type descriptions"
              role="button"
              aria-label="Show import type descriptions"
            >
              i
            </span>
          </div>
        }
        footer={
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
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
              <>
                {canListFeeds && (
                  <button className="btn btn-secondary" onClick={fetchHostedFeeds} disabled={loadingHostedFeeds}>
                    {loadingHostedFeeds ? 'Loading...' : 'Refresh'}
                  </button>
                )}
                {showManualImport && (
                  <button className="btn btn-primary" onClick={handleImportHosted} disabled={loading || !hostedFeedId.trim()}>
                    {loading ? 'Importing...' : 'Import by ID'}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
                {loading ? 'Importing...' : 'Import Feed'}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        }
      >
          {templateMode && (
            <div style={{
              padding: '10px 14px',
              marginBottom: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--accent-bg-subtle)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
            }}>
              The imported feed will get a new GUID and won't be linked to any hosted feed.
            </div>
          )}
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
                // 'hosted' fetch happens in the mode/isLoggedIn effect above
              }}
            >
              <option value="file">Upload File</option>
              <option value="paste">Paste XML</option>
              <option value="url">From URL</option>
              <option value="hosted">MSP Hosted</option>
              {isLoggedIn && <option value="nostrMusic">From Nostr Music</option>}
              {showExperimental && <option value="nostrEvent">Nostr Event 🧪</option>}
              {showExperimental && isLoggedIn && <option value="nostr">From Nostr 🧪</option>}
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
                            style={{ width: '48px', height: '48px', borderRadius: '4px', objectFit: 'contain', backgroundColor: 'var(--surface-color)' }}
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
              {/* Show user's hosted feeds if logged in (Nostr or email) */}
              {canListFeeds && (
                <div style={{ marginBottom: '16px' }}>
                  <label className="form-label">My Hosted Feeds</label>
                  <select
                    className="form-select"
                    value=""
                    onChange={(e) => {
                      const feedId = e.target.value;
                      if (feedId) {
                        const feed = hostedFeeds.find(f => f.feedId === feedId);
                        if (feed) handleImportHostedFeed(feed);
                      }
                    }}
                    disabled={loading || loadingHostedFeeds}
                  >
                    <option value="">
                      {loadingHostedFeeds
                        ? 'Loading...'
                        : hostedFeeds.length > 0
                          ? `Select a feed (${hostedFeeds.length})`
                          : 'No feeds found'}
                    </option>
                    {hostedFeeds.map((feed) => {
                      const feedType = feed.medium === 'publisher' ? '[Publisher]' : feed.medium === 'video' ? '[Video]' : '[Album]';
                      return (
                        <option key={feed.feedId} value={feed.feedId}>
                          {feedType} {feed.title || 'Untitled Feed'} {feed.author ? `- ${feed.author}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Logged out: signing in is the primary way to find your hosted feeds. */}
              {!canListFeeds && (
                <SignInPrompt
                  style={{ marginBottom: '16px' }}
                  title="Sign in to see your feeds"
                  blurb="Sign in with email or Nostr to browse and import every feed you've hosted on MSP — no Feed ID needed."
                  onEmail={() => setShowEmailLogin(true)}
                  onNostr={() => setShowNostrConnect(true)}
                />
              )}

              {/* Advanced / token path: collapsed by default. */}
              <button
                type="button"
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginBottom: showManualImport ? '12px' : 0 }}
                onClick={() => setShowManualImport(v => !v)}
              >
                {showManualImport ? 'Hide manual import' : 'Have a Feed ID or edit token? Import manually'}
              </button>

              {showManualImport && (
              <>
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
                If you have your edit token, enter it to enable editing after import. You'll still need to sign in to save changes.
              </p>
              </>
              )}
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
                <li><strong>MSP Hosted</strong> - Sign in with email or Nostr to browse and import your hosted feeds. If you have a saved Feed ID or edit token, you can still import manually.</li>
                <li><strong>From Nostr Music</strong> - Import tracks from Nostr Music library (requires login)</li>
                {showExperimental && <li><strong>Nostr Event 🧪</strong> - Import from a Nostr Event (kind 36787)</li>}
                {showExperimental && <li><strong>From Nostr 🧪</strong> - Load your previously saved albums from Nostr (requires login)</li>}
              </ul>
            </ModalWrapper>
      )}

      {showEmailLogin && (
        <EmailLoginModal onClose={() => {
          setShowEmailLogin(false);
          if (mode === 'hosted' && isEmailLoggedIn()) fetchHostedFeeds();
        }} />
      )}
      {showNostrConnect && (
        <NostrConnectModal onClose={() => setShowNostrConnect(false)} />
      )}
    </>
  );
}
