import { useState, useEffect } from 'react';
import { generateRssFeed, generatePublisherRssFeed, downloadXml, copyToClipboard } from '../../utils/xmlGenerator';
import { saveFeedToNostr, publishNostrMusicTracks } from '../../utils/nostrSync';
import { uploadFeedToBlossom } from '../../utils/blossom';
import type { PublishProgress } from '../../utils/nostrSync';
import type { Album, PublisherFeed } from '../../types/feed';
import type { FeedType } from '../../store/feedStore';
import {
  getHostedFeedInfo,
  saveHostedFeedInfo,
  clearHostedFeedInfo,
  createHostedFeed,
  updateHostedFeed,
  buildHostedUrl,
  downloadHostedFeedBackup,
  generateEditToken,
  createHostedFeedWithNostr,
  updateHostedFeedWithNostr,
  linkNostrToFeed,
  type HostedFeedInfo
} from '../../utils/hostedFeed';
import { albumStorage, publisherStorage, pendingHostedStorage } from '../../utils/storage';
import { useNostr } from '../../store/nostrStore';
import { ModalWrapper } from './ModalWrapper';

const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net/';

interface SaveModalProps {
  onClose: () => void;
  album: Album;
  publisherFeed?: PublisherFeed | null;
  feedType?: FeedType;
  isDirty: boolean;
  isLoggedIn: boolean;
  onImport?: (xml: string) => void;
}

export function SaveModal({ onClose, album, publisherFeed, feedType = 'album', isDirty, isLoggedIn, onImport }: SaveModalProps) {
  const { state: nostrState } = useNostr();
  const [mode, setMode] = useState<'local' | 'download' | 'clipboard' | 'nostr' | 'nostrMusic' | 'blossom' | 'hosted' | 'podcastIndex'>('local');
  const isPublisherMode = feedType === 'publisher';

  // Helper to get current feed's GUID and title based on mode
  const currentFeedGuid = isPublisherMode && publisherFeed ? publisherFeed.podcastGuid : album.podcastGuid;
  const currentFeedTitle = isPublisherMode && publisherFeed ? publisherFeed.title : album.title;

  // Helper function to generate XML for current feed type
  const generateCurrentFeedXml = () => {
    if (isPublisherMode && publisherFeed) {
      return generatePublisherRssFeed(publisherFeed);
    }
    return generateRssFeed(album);
  };

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [blossomServer, setBlossomServer] = useState(DEFAULT_BLOSSOM_SERVER);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [stableUrl, setStableUrl] = useState<string | null>(null);
  const [hostedInfo, setHostedInfo] = useState<HostedFeedInfo | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [legacyHostedInfo, setLegacyHostedInfo] = useState<HostedFeedInfo | null>(null); // For feeds with mismatched feedId
  const [showRestore, setShowRestore] = useState(false);
  const [restoreFeedId, setRestoreFeedId] = useState('');
  const [restoreToken, setRestoreToken] = useState('');
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [tokenAcknowledged, setTokenAcknowledged] = useState(false);
  const [linkingNostr, setLinkingNostr] = useState(false);
  const [podcastIndexUrl, setPodcastIndexUrl] = useState('');
  const [submittingToIndex, setSubmittingToIndex] = useState(false);
  const [podcastIndexPageUrl, setPodcastIndexPageUrl] = useState<string | null>(null);
  const [podcastIndexPending, setPodcastIndexPending] = useState(false); // True when PI notified but not yet indexed

  // Check if feed is linked to current user's Nostr identity
  const isNostrLinked = hostedInfo?.ownerPubkey && nostrState.user?.pubkey === hostedInfo.ownerPubkey;

  // Helper to get button text based on mode and loading state
  const getButtonText = () => {
    if (mode === 'podcastIndex') return submittingToIndex ? 'Submitting...' : 'Submit';
    if (loading) {
      if (mode === 'nostrMusic' || mode === 'blossom' || mode === 'hosted') return 'Uploading...';
      if (mode === 'download') return 'Downloading...';
      if (mode === 'clipboard') return 'Copying...';
      return 'Saving...';
    }
    if (mode === 'nostrMusic') return 'Publish';
    if (mode === 'blossom' || mode === 'hosted') return 'Upload';
    if (mode === 'download') return 'Download';
    if (mode === 'clipboard') return 'Copy to Clipboard';
    return 'Save';
  };

  // Helper to determine if button should be disabled
  const isButtonDisabled = () => {
    if (mode === 'podcastIndex') return submittingToIndex || !podcastIndexUrl.trim();
    if (loading) return true;
    if (mode === 'hosted' && !hostedInfo && !legacyHostedInfo && !tokenAcknowledged) return true;
    return false;
  };

  // Notify Podcast Index and return the PI page URL if available
  const notifyPodcastIndex = async (feedUrl: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/pubnotify?url=${encodeURIComponent(feedUrl)}`);
      const data = await res.json();
      if (data.success) {
        if (data.podcastIndexUrl) {
          // Feed is already indexed - we have a direct page URL
          setPodcastIndexPageUrl(data.podcastIndexUrl);
          setPodcastIndexPending(false);
          return data.podcastIndexUrl;
        } else {
          // Feed submitted but not yet indexed
          setPodcastIndexPending(true);
          setPodcastIndexPageUrl(null);
          return 'pending';
        }
      }
    } catch (err) {
      console.warn('Failed to notify Podcast Index:', err);
    }
    return null;
  };

  // Auto-populate Podcast Index URL when a hosted URL becomes available
  useEffect(() => {
    if (mode === 'blossom' && stableUrl) {
      setPodcastIndexUrl(stableUrl);
    } else if (mode === 'hosted' && hostedUrl) {
      setPodcastIndexUrl(hostedUrl);
    }
  }, [mode, hostedUrl, stableUrl]);

  // Generate token when selecting hosted mode for a new feed
  useEffect(() => {
    if (mode === 'hosted' && !hostedInfo && !legacyHostedInfo && !pendingToken && !showRestore) {
      setPendingToken(generateEditToken());
    }
  }, [mode, hostedInfo, legacyHostedInfo, pendingToken, showRestore]);

  // Check for existing hosted feed on mount, and apply pending credentials
  useEffect(() => {
    if (!currentFeedGuid) return;

    // Check for pending credentials from import
    const pending = pendingHostedStorage.load();
    if (pending) {
      // If pending feedId matches podcastGuid, use it; otherwise it's legacy
      if (pending.feedId === currentFeedGuid) {
        saveHostedFeedInfo(currentFeedGuid, pending);
        pendingHostedStorage.clear();
        setHostedInfo(pending);
        setHostedUrl(buildHostedUrl(pending.feedId));
        return;
      } else {
        // Legacy feed with mismatched ID - save as legacy, will update both on save
        pendingHostedStorage.clear();
        setLegacyHostedInfo(pending);
      }
    }

    const info = getHostedFeedInfo(currentFeedGuid);
    if (info) {
      // Check if feedId matches podcastGuid (legacy feeds may have different IDs)
      if (info.feedId === currentFeedGuid) {
        setHostedInfo(info);
        setHostedUrl(buildHostedUrl(info.feedId));
      } else {
        // Legacy feed with mismatched ID - keep it to update both URLs on save
        setLegacyHostedInfo(info);
        // Show the correct URL (podcastGuid) as the primary
        setHostedUrl(buildHostedUrl(currentFeedGuid));
      }
    }
  }, [currentFeedGuid]);

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
      const xml = generateCurrentFeedXml();
      await updateHostedFeed(restoreFeedId.trim(), restoreToken.trim(), xml, currentFeedTitle);

      // Credentials work - save them
      const newInfo: HostedFeedInfo = {
        feedId: restoreFeedId.trim(),
        editToken: restoreToken.trim(),
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      saveHostedFeedInfo(currentFeedGuid, newInfo);
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
      pendingHostedStorage.save(newInfo);

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

    // Validate required fields only for publishing modes (not local/download/clipboard)
    const requiresValidation = !['local', 'download', 'clipboard'].includes(mode);
    if (requiresValidation) {
      const errors: string[] = [];

      if (isPublisherMode && publisherFeed) {
        // Publisher feed validation
        if (!publisherFeed.author?.trim()) errors.push('Publisher Name');
        if (!publisherFeed.title?.trim()) errors.push('Catalog Title');
        if (!publisherFeed.description?.trim()) errors.push('Description');
        if (!publisherFeed.podcastGuid?.trim()) errors.push('Publisher GUID');
      } else {
        // Album validation
        if (!album.author?.trim()) errors.push('Artist/Band');
        if (!album.title?.trim()) errors.push('Album Title');
        if (!album.description?.trim()) errors.push('Description');
        if (!album.imageUrl?.trim()) errors.push('Album Art URL');
        if (!album.language?.trim()) errors.push('Language');
        if (!album.podcastGuid?.trim()) errors.push('Podcast GUID');

        album.tracks.forEach((track, i) => {
          if (!track.title?.trim()) errors.push(`Track ${i + 1} Title`);
          if (!track.duration?.trim()) errors.push(`Track ${i + 1} Duration`);
          if (!track.enclosureUrl?.trim()) errors.push(`Track ${i + 1} MP3 URL`);
          if (!track.enclosureLength?.trim()) errors.push(`Track ${i + 1} File Size`);
        });
      }

      if (errors.length > 0) {
        setMessage({ type: 'error', text: `Missing required fields: ${errors.join(', ')}` });
        setLoading(false);
        return;
      }
    }

    // Helper to show success and auto-close
    const showSuccessAndClose = (text: string, delay = 1500) => {
      setMessage({ type: 'success', text });
      setTimeout(() => onClose(), delay);
    };

    try {
      switch (mode) {
        case 'local':
          if (isPublisherMode && publisherFeed) {
            publisherStorage.save(publisherFeed);
          } else {
            albumStorage.save(album);
          }
          showSuccessAndClose('Saved to browser storage');
          break;
        case 'download':
          const xml = generateCurrentFeedXml();
          const feedTitle = isPublisherMode && publisherFeed ? publisherFeed.title : album.title;
          const publisherName = isPublisherMode && publisherFeed?.author ? `${publisherFeed.author}_` : '';
          const filename = `${publisherName}${feedTitle || 'feed'}.xml`.replace(/[^a-z0-9.-]/gi, '_');
          downloadXml(xml, filename);
          showSuccessAndClose('Download started');
          break;
        case 'clipboard':
          const xmlContent = generateCurrentFeedXml();
          await copyToClipboard(xmlContent);
          showSuccessAndClose('Copied to clipboard');
          break;
        case 'nostr':
          const nostrResult = isPublisherMode && publisherFeed
            ? await saveFeedToNostr(publisherFeed, 'publisher', isDirty)
            : await saveFeedToNostr(album, 'album', isDirty);
          if (nostrResult.success) {
            showSuccessAndClose(nostrResult.message);
          } else {
            setMessage({ type: 'error', text: nostrResult.message });
          }
          break;
        case 'nostrMusic':
          const musicResult = await publishNostrMusicTracks(album, undefined, setProgress);
          setProgress(null);
          // Show error/warning if not all tracks published or playlist failed
          const allTracksPublished = musicResult.publishedCount === album.tracks.length;
          const playlistExpected = album.tracks.length >= 2;
          const hasPartialFailure = !allTracksPublished || (playlistExpected && !musicResult.playlistPublished);
          if (musicResult.success && !hasPartialFailure) {
            showSuccessAndClose(musicResult.message);
          } else {
            setMessage({ type: 'error', text: musicResult.message });
          }
          break;
        case 'blossom':
          const blossomResult = isPublisherMode && publisherFeed
            ? await uploadFeedToBlossom(publisherFeed, 'publisher', blossomServer)
            : await uploadFeedToBlossom(album, 'album', blossomServer);
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
          const hostedXml = generateCurrentFeedXml();

          // If there's a legacy feed with mismatched feedId, update it first
          if (legacyHostedInfo && legacyHostedInfo.feedId !== currentFeedGuid) {
            try {
              await updateHostedFeed(legacyHostedInfo.feedId, legacyHostedInfo.editToken, hostedXml, currentFeedTitle);
            } catch (legacyErr) {
              // Log but don't fail - legacy feed update is best-effort
              console.warn('Failed to update legacy feed:', legacyErr);
            }
          }

          if (hostedInfo) {
            // Update existing feed - use Nostr auth if linked, otherwise token
            if (isNostrLinked) {
              await updateHostedFeedWithNostr(hostedInfo.feedId, hostedXml, currentFeedTitle);
            } else {
              await updateHostedFeed(hostedInfo.feedId, hostedInfo.editToken, hostedXml, currentFeedTitle);
            }
            const updatedInfo = { ...hostedInfo, lastUpdated: Date.now() };
            saveHostedFeedInfo(currentFeedGuid, updatedInfo);
            setHostedInfo(updatedInfo);
            const piUrl = await notifyPodcastIndex(buildHostedUrl(hostedInfo.feedId));
            if (piUrl) {
              setMessage({ type: 'success', text: 'Feed updated and Podcast Index notified!' });
            } else {
              showSuccessAndClose('Feed updated!');
            }
          } else if (pendingToken || legacyHostedInfo) {
            // Create new feed at correct URL - use Nostr auth if user opted in
            // Use legacy token if available, otherwise use pending token
            const tokenToUse = legacyHostedInfo?.editToken || pendingToken;
            if (!tokenToUse) {
              throw new Error('No edit token available');
            }

            let hostedResult;
            let newInfo: HostedFeedInfo;
            const shouldLinkNostr = isLoggedIn && nostrState.user?.pubkey;
            if (shouldLinkNostr) {
              hostedResult = await createHostedFeedWithNostr(hostedXml, currentFeedTitle, currentFeedGuid, tokenToUse);
              newInfo = {
                feedId: hostedResult.feedId,
                editToken: tokenToUse,
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                ownerPubkey: nostrState.user!.pubkey,
                linkedAt: Date.now()
              };
            } else {
              hostedResult = await createHostedFeed(hostedXml, currentFeedTitle, currentFeedGuid, tokenToUse);
              newInfo = {
                feedId: hostedResult.feedId,
                editToken: tokenToUse,
                createdAt: Date.now(),
                lastUpdated: Date.now()
              };
            }
            saveHostedFeedInfo(currentFeedGuid, newInfo);
            setHostedInfo(newInfo);
            setHostedUrl(hostedResult.url);
            setPendingToken(null);
            setLegacyHostedInfo(null);
            setTokenAcknowledged(false);
            const piUrl = await notifyPodcastIndex(hostedResult.url);
            let successMsg = legacyHostedInfo
              ? 'Feed migrated to new URL and legacy URL updated!'
              : (shouldLinkNostr ? 'Feed created and linked to your Nostr identity!' : 'Feed created!');
            if (piUrl) {
              successMsg += ' Podcast Index notified!';
            }
            setMessage({ type: 'success', text: successMsg });
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

  const handleClose = () => {
    onClose();
  };

  // Link Nostr identity to existing feed
  const handleLinkNostr = async () => {
    if (!hostedInfo) return;

    setLinkingNostr(true);
    setMessage(null);

    try {
      const result = await linkNostrToFeed(hostedInfo.feedId, hostedInfo.editToken);

      // Update local storage with linked pubkey
      const updatedInfo = {
        ...hostedInfo,
        ownerPubkey: result.pubkey,
        linkedAt: Date.now()
      };
      saveHostedFeedInfo(currentFeedGuid, updatedInfo);
      setHostedInfo(updatedInfo);

      setMessage({ type: 'success', text: 'Nostr identity linked! You can now sign in to edit.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to link Nostr identity' });
    } finally {
      setLinkingNostr(false);
    }
  };

  // Submit feed URL to Podcast Index
  const handleSubmitToPodcastIndex = async () => {
    if (!podcastIndexUrl.trim()) {
      setMessage({ type: 'error', text: 'Please enter a feed URL' });
      return;
    }

    setSubmittingToIndex(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/pubnotify?url=${encodeURIComponent(podcastIndexUrl.trim())}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit to Podcast Index');
      }

      // Generate search URL so user can view their feed on Podcast Index
      const searchUrl = `https://podcastindex.org/search?q=${encodeURIComponent(podcastIndexUrl.trim())}`;
      setPodcastIndexPageUrl(data.podcastIndexUrl || searchUrl);
      setMessage({ type: 'success', text: 'Feed submitted! It may take a moment to appear in the index.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit to Podcast Index' });
    } finally {
      setSubmittingToIndex(false);
    }
  };

  return (
    <>
      <ModalWrapper
        isOpen={true}
        onClose={handleClose}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            Save Feed
            <span
              className="import-help-icon"
              onClick={() => setShowHelp(true)}
              title="Show save type descriptions"
            >
              ℹ️
            </span>
          </div>
        }
        footer={
          <>
            <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={mode === 'podcastIndex' ? handleSubmitToPodcastIndex : handleSave}
              disabled={isButtonDisabled()}
            >
              {getButtonText()}
            </button>
          </>
        }
      >
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label">Save Destination</label>
            <select
              className="form-select"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="local">Local Storage</option>
              <option value="download">Download XML</option>
              <option value="clipboard">Copy to Clipboard</option>
              <option value="hosted">Host on MSP</option>
              <option value="podcastIndex">Submit to Podcast Index</option>
              {isLoggedIn && <option value="nostr">Save to Nostr</option>}
              {!isPublisherMode && isLoggedIn && <option value="nostrMusic">Publish Nostr Music</option>}
              {isLoggedIn && <option value="blossom">Publish to Blossom</option>}
            </select>
          </div>

          <div className="nostr-album-preview">
            {isPublisherMode && publisherFeed ? (
              <>
                <h3>{publisherFeed.title || 'Untitled Publisher Feed'}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {publisherFeed.author || 'No publisher'} &bull; {publisherFeed.remoteItems.length} feed{publisherFeed.remoteItems.length !== 1 ? 's' : ''} in catalog
                </p>
              </>
            ) : (
              <>
                <h3>{album.title || 'Untitled Album'}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {album.author || 'No author'} &bull; {album.tracks.length} track{album.tracks.length !== 1 ? 's' : ''}
                </p>
              </>
            )}
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
              Publish tracks and playlist to Nostr (kinds 36787 + 34139). Compatible with Nostr music clients.
            </p>
          )}
          {mode === 'blossom' && (
            <div style={{ marginTop: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                Upload your RSS feed to a Blossom server. Get a permanent URL for podcast apps.
              </p>
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
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
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem'
                  }}
                />
              </div>
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
                  : legacyHostedInfo
                    ? 'Your feed URL will be migrated to match the Podcast GUID. Both old and new URLs will be updated.'
                    : pendingToken
                      ? 'Save your edit token before uploading!'
                      : 'Host your RSS feed on MSP. No account required - just save your edit token!'}
              </p>
              {legacyHostedInfo && !hostedInfo && (
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    <strong style={{ color: '#3b82f6' }}>Feed Migration</strong>
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Old URL: <code style={{ fontSize: '0.65rem' }}>{buildHostedUrl(legacyHostedInfo.feedId)}</code>
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    New URL: <code style={{ fontSize: '0.65rem' }}>{buildHostedUrl(currentFeedGuid)}</code>
                  </p>
                </div>
              )}
              {pendingToken && !hostedInfo && !legacyHostedInfo && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--warning, #f59e0b)' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--warning, #f59e0b)' }}>
                    {isLoggedIn ? 'Backup Token (save this!)' : 'Edit Token (save this!)'}
                  </label>
                  <input
                    type="text"
                    value={pendingToken}
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
                  <p style={{ color: 'var(--warning, #f59e0b)', fontSize: '0.75rem', marginTop: '8px', marginBottom: '12px' }}>
                    You need this token to edit your feed later. Save it somewhere safe!
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(pendingToken);
                        setMessage({ type: 'success', text: 'Token copied to clipboard' });
                      }}
                    >
                      Copy Token
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        downloadHostedFeedBackup(currentFeedGuid, pendingToken, currentFeedTitle, currentFeedGuid);
                        setMessage({ type: 'success', text: 'Backup file downloaded' });
                      }}
                    >
                      Download Backup
                    </button>
                  </div>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: 'var(--text-primary)',
                    padding: '8px',
                    backgroundColor: tokenAcknowledged ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                    borderRadius: '4px',
                    border: tokenAcknowledged ? '1px solid var(--success, #10b981)' : '1px solid var(--border-color)'
                  }}>
                    <input
                      type="checkbox"
                      checked={tokenAcknowledged}
                      onChange={(e) => setTokenAcknowledged(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span>I have saved my edit token</span>
                  </label>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '6px 12px', marginTop: '12px', width: '100%' }}
                    onClick={() => {
                      setPendingToken(null);
                      setTokenAcknowledged(false);
                      setShowRestore(true);
                    }}
                  >
                    Already have a token? Restore existing feed
                  </button>
                </div>
              )}
              {hostedUrl && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--success)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                    Your Feed URL
                    {isNostrLinked && (
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', borderRadius: '4px' }}>
                        Linked to Nostr
                      </span>
                    )}
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
                        clearHostedFeedInfo(currentFeedGuid);
                        setHostedInfo(null);
                        setHostedUrl(null);
                        setMessage({ type: 'success', text: 'Feed unlinked from this browser' });
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                  {(podcastIndexPageUrl || podcastIndexPending) && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Podcast Index
                      </label>
                      {podcastIndexPageUrl ? (
                        <a
                          href={podcastIndexPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '0.875rem', color: '#3b82f6', wordBreak: 'break-all' }}
                        >
                          {podcastIndexPageUrl}
                        </a>
                      ) : (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                          Feed submitted to Podcast Index. It may take a few minutes to appear.
                          <br />
                          <a
                            href={`https://podcastindex.org/search?q=${encodeURIComponent(hostedUrl || '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#3b82f6' }}
                          >
                            Check status or add manually →
                          </a>
                        </p>
                      )}
                    </div>
                  )}
                  {/* Link Nostr button for existing feeds without Nostr link */}
                  {isLoggedIn && hostedInfo && !isNostrLinked && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Link your Nostr identity to manage this feed without needing the token.
                      </p>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem' }}
                        onClick={handleLinkNostr}
                        disabled={linkingNostr}
                      >
                        {linkingNostr ? 'Linking...' : 'Link Nostr Identity'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!hostedInfo && !pendingToken && !legacyHostedInfo && (
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
                      {/* Upload backup file - primary option */}
                      <label
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '20px',
                          marginBottom: '12px',
                          border: '2px dashed var(--border-color)',
                          borderRadius: '8px',
                          backgroundColor: 'var(--bg-secondary)',
                          cursor: 'pointer',
                          transition: 'border-color 0.2s'
                        }}
                      >
                        <span style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📁</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Upload Backup File
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Drop your .json backup file here or click to browse
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
                                // Support both old and new format
                                const feedId = json.feedId || json.feed_id || json.msp_hosted_feed_backup?.feed_id;
                                const token = json.editToken || json.edit_token || json.msp_hosted_feed_backup?.edit_token;
                                if (feedId && token) {
                                  setRestoreFeedId(feedId);
                                  setRestoreToken(token);
                                  setMessage({ type: 'success', text: 'Backup file loaded! Click "Link Credentials" to restore.' });
                                } else {
                                  setMessage({ type: 'error', text: 'Invalid backup file format' });
                                }
                              } catch {
                                setMessage({ type: 'error', text: 'Could not parse backup file' });
                              }
                            };
                            reader.readAsText(file);
                            e.target.value = '';
                          }}
                          style={{ display: 'none' }}
                        />
                      </label>

                      {/* Divider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '12px 0' }}>
                        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>OR ENTER MANUALLY</span>
                        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }} />
                      </div>

                      {/* Manual entry fields */}
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Feed ID
                      </label>
                      <input
                        type="text"
                        value={restoreFeedId}
                        onChange={(e) => setRestoreFeedId(e.target.value)}
                        placeholder="e.g. 95761582-a064-4430-8192-4571d8d3715b"
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
                          onClick={handleRestore}
                          disabled={restoreLoading}
                        >
                          {restoreLoading ? 'Loading...' : 'Link Credentials'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                          onClick={handleImportAndRestore}
                          disabled={restoreLoading}
                        >
                          Import & Link
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
                        <strong>Link Credentials</strong>: Links credentials without changing current content<br />
                        <strong>Import & Link</strong>: Fetches feed content and loads it into the editor
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'podcastIndex' && (
            <div style={{ marginTop: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                Notify Podcast Index about your feed so apps like Fountain, Castamatic, and others can find it.
              </p>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Feed URL
                </label>
                <input
                  type="text"
                  value={podcastIndexUrl}
                  onChange={(e) => setPodcastIndexUrl(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace'
                  }}
                />
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Use this to submit a new feed or notify Podcast Index that an existing feed has been updated.
              </p>
              {podcastIndexPageUrl && (
                <div style={{
                  marginBottom: '12px',
                  padding: '12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid var(--success)'
                }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)' }}>
                    View on Podcast Index
                  </label>
                  <a
                    href={podcastIndexPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.875rem', color: '#3b82f6', wordBreak: 'break-all' }}
                  >
                    {podcastIndexPageUrl}
                  </a>
                </div>
              )}
              <a
                href="https://podcastindex.org/add"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#3b82f6' }}
              >
                Add feed manually on podcastindex.org →
              </a>
            </div>
          )}

          {progress && (
            <div style={{ marginTop: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {progress.phase === 'tracks'
                ? `Publishing track ${progress.current} of ${progress.total}: ${progress.trackTitle}`
                : `Publishing playlist: ${progress.trackTitle}`
              }
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
        </ModalWrapper>

      {showHelp && (
        <ModalWrapper
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          title="Save Types"
          className="import-help-modal"
          style={{ zIndex: 1001 }}
          footer={
            <button className="btn btn-primary" onClick={() => setShowHelp(false)}>Got it</button>
          }
        >
          <ul className="import-help-list">
                <li><strong>Local Storage</strong> - Save to your browser's local storage. Data persists until you clear browser data.</li>
                <li><strong>Download XML</strong> - Download the RSS feed as an XML file to your computer.</li>
                <li><strong>Copy to Clipboard</strong> - Copy the RSS XML to your clipboard for pasting elsewhere.</li>
                <li><strong>Host on MSP</strong> - Host your feed on MSP servers. Get a permanent URL for your RSS feed to use in any app.{isLoggedIn && ' You can link your Nostr identity to edit from any device without needing the token.'}</li>
                <li><strong>Submit to Podcast Index</strong> - Notify Podcast Index about your feed URL so podcast apps can discover it. Use this for new feeds or to notify them of updates.</li>
                <li><strong>Save to Nostr</strong> - Publish to Nostr relays. Load it later on any device with your Nostr key (requires login).</li>
                <li><strong>Publish Nostr Music</strong> - Publish tracks and playlist (kinds 36787 + 34139) for Nostr music clients (requires login).</li>
                <li><strong>Publish to Blossom</strong> - Upload your feed to a Blossom server. Get a stable MSP URL that always points to your latest upload (requires login).</li>
              </ul>
            </ModalWrapper>
      )}
    </>
  );
}
