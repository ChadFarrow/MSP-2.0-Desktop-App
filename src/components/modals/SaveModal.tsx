import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { generateRssFeed, generatePublisherRssFeed, downloadXml, copyToClipboard } from '../../utils/xmlGenerator';
import { saveFeedToNostr, publishNostrMusicTracks, deleteNostrMusicTracks } from '../../utils/nostrSync';
import { uploadFeedToBlossom } from '../../utils/blossom';
import { publishToNsite, defaultSiteId } from '../../utils/nsite';
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
  generateEditToken,
  createHostedFeedWithNostr,
  updateHostedFeedWithNostr,
  linkNostrToFeed,
  createHostedFeedWithEmail,
  updateHostedFeedWithEmail,
  linkEmailToFeed,
  type HostedFeedInfo
} from '../../utils/hostedFeed';
import { albumStorage, videoStorage, publisherStorage, pendingHostedStorage } from '../../utils/storage';
import { getEmailSession, isEmailLoggedIn } from '../../utils/emailSession';
import { EmailLoginModal } from '../auth/EmailLoginModal';
import { SignInPrompt } from '../auth/SignInPrompt';
import { NostrConnectModal } from './NostrConnectModal';
import { useNostr } from '../../store/nostrStore';
import { useExperimental } from '../../store/experimentalStore';
import { checkSignerConnection } from '../../utils/nostrSigner';
import { getFeedUrlError } from '../../utils/urlValidation';
import { getValueRecipientErrors } from '../../utils/valueValidation';
import { ModalWrapper } from './ModalWrapper';

const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net/';

type SaveMode = 'local' | 'download' | 'clipboard' | 'nostr' | 'nostrMusic' | 'blossom' | 'nsite' | 'hosted' | 'podcastIndex';

interface SaveDestination {
  value: SaveMode;
  label: string;
  blurb: string;
  experimental?: boolean;
}

// Single source of truth for the destination dropdown. `blurb` is the short
// inline description; the richer wording lives in the ℹ️ help popup below.
const SAVE_DESTINATIONS: SaveDestination[] = [
  { value: 'local', label: 'Local Storage', blurb: 'Save in this browser only' },
  { value: 'download', label: 'Download XML', blurb: 'Download the RSS feed as an XML file' },
  { value: 'clipboard', label: 'Copy to Clipboard', blurb: 'Copy the RSS XML to your clipboard' },
  { value: 'hosted', label: 'Host on MSP', blurb: 'Permanent URL hosted on MSP — use in any podcast app' },
  { value: 'podcastIndex', label: 'Submit to PodcastIndex', blurb: 'Submit a feed URL so apps can discover it' },
  { value: 'nostrMusic', label: 'Publish to Nostr Music', blurb: 'Per-track Nostr events for Nostr-native music apps like Sunami' },
  { value: 'nostr', label: 'Save RSS feed to Nostr', blurb: 'Back up the full RSS inside a Nostr event', experimental: true },
  { value: 'blossom', label: 'Publish RSS feed to a Blossom server', blurb: 'Host the RSS on a Blossom server', experimental: true },
  { value: 'nsite', label: 'Publish RSS feed to nsite', blurb: 'Publish the RSS as an nsite web URL', experimental: true },
];

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
  const { showExperimental } = useExperimental();
  const [mode, setMode] = useState<SaveMode>('local');
  const [destOpen, setDestOpen] = useState(false);
  const [destMenuPos, setDestMenuPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const destRef = useRef<HTMLDivElement>(null);
  const destMenuRef = useRef<HTMLUListElement>(null);
  const isPublisherMode = feedType === 'publisher';
  const isVideoMode = feedType === 'video';

  // Helper to get current feed's GUID and title based on mode
  const currentFeedGuid = isPublisherMode && publisherFeed ? publisherFeed.podcastGuid : album.podcastGuid;
  const currentFeedTitle = isPublisherMode && publisherFeed ? publisherFeed.title : album.title;

  // Helper function to generate XML for current feed type
  // Always updates lastBuildDate to current time per RSS 2.0 spec
  const generateCurrentFeedXml = () => {
    const now = new Date().toUTCString();
    if (isPublisherMode && publisherFeed) {
      return generatePublisherRssFeed({ ...publisherFeed, lastBuildDate: now });
    }
    return generateRssFeed({ ...album, lastBuildDate: now });
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
  const [linkingNostr, setLinkingNostr] = useState(false);
  const [linkingEmail, setLinkingEmail] = useState(false);
  const [emailModal, setEmailModal] = useState<null | { mode: 'login' } | { mode: 'claim' }>(null);
  const [showNostrConnect, setShowNostrConnect] = useState(false);
  const [podcastIndexPending, setPodcastIndexPending] = useState(false); // True when PI notified but not yet indexed
  const [isDraft, setIsDraft] = useState(false);
  const nsiteSiteId = defaultSiteId(currentFeedGuid);
  const [nsiteUrl, setNsiteUrl] = useState<string | null>(null);
  const [nsiteBlossomUrl, setNsiteBlossomUrl] = useState<string | null>(null);
  const [nsitePiUrl, setNsitePiUrl] = useState<string | null>(null);
  const [nsiteProgress, setNsiteProgress] = useState<string | null>(null);
  const [podcastIndexSubmitUrl, setPodcastIndexSubmitUrl] = useState('');
  const [podcastIndexResultUrl, setPodcastIndexResultUrl] = useState<string | null>(null);

  // Check if feed is linked to current user's Nostr identity
  const isNostrLinked = hostedInfo?.ownerPubkey && nostrState.user?.pubkey === hostedInfo.ownerPubkey;

  // Check if feed is claimed by the current email account
  const emailSession = getEmailSession();
  const isEmailLinked = !!(hostedInfo?.ownerEmailHash && emailSession?.emailHash === hostedInfo.ownerEmailHash);

  // Helper to get button text based on mode and loading state
  const getButtonText = () => {
    if (loading) {
      if (mode === 'nostrMusic' || mode === 'blossom' || mode === 'hosted' || mode === 'nsite') return 'Uploading...';
      if (mode === 'download') return 'Downloading...';
      if (mode === 'clipboard') return 'Copying...';
      if (mode === 'podcastIndex') return 'Submitting...';
      return 'Saving...';
    }
    if (mode === 'nostrMusic') return 'Publish';
    if (mode === 'blossom' || mode === 'hosted' || mode === 'nsite') return 'Upload';
    if (mode === 'download') return 'Download';
    if (mode === 'clipboard') return 'Copy to Clipboard';
    if (mode === 'podcastIndex') return 'Submit to PodcastIndex';
    return 'Save';
  };

  const podcastIndexUrlError = mode === 'podcastIndex' ? getFeedUrlError(podcastIndexSubmitUrl.trim()) : null;

  // Helper to determine if button should be disabled
  const isButtonDisabled = () => {
    if (loading) return true;
    // Every MSP-hosting write (create a new feed OR update an existing one) now
    // requires being signed in with email or Nostr. The edit token alone no longer
    // authorizes a save from the main button — it's only used to auto-claim a
    // token-owned feed onto the account on the first signed-in save. (Token holders
    // can still recover a feed via the "Restore" panel below.)
    if (mode === 'hosted' && !isEmailLoggedIn() && !isLoggedIn) return true;
    if (mode === 'podcastIndex' && (!podcastIndexSubmitUrl.trim() || !!podcastIndexUrlError)) return true;
    return false;
  };

  // Generate token when selecting hosted mode for a new feed
  useEffect(() => {
    if (mode === 'hosted' && !hostedInfo && !legacyHostedInfo && !pendingToken && !showRestore) {
      setPendingToken(generateEditToken());
    }
  }, [mode, hostedInfo, legacyHostedInfo, pendingToken, showRestore]);

  // Reset mode if the current selection is an experimental option that just got hidden
  useEffect(() => {
    if (!showExperimental && (mode === 'nostr' || mode === 'blossom' || mode === 'nsite')) {
      setMode('local');
    }
  }, [showExperimental, mode]);

  // Close the destination dropdown when clicking outside it. The menu is
  // portaled to <body> (to escape the modal's overflow clipping), so the
  // outside check has to ignore the portaled menu too.
  useEffect(() => {
    if (!destOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (destRef.current?.contains(target) || destMenuRef.current?.contains(target)) return;
      setDestOpen(false);
    };
    // The fixed-positioned menu detaches from the trigger when the page/modal
    // scrolls, so close it — but ignore the menu's OWN internal scroll (capture
    // phase sees it), otherwise scrolling the option list would close the menu.
    const handleScroll = (e: Event) => {
      if (destMenuRef.current && e.target instanceof Node && destMenuRef.current.contains(e.target)) return;
      setDestOpen(false);
    };
    const handleResize = () => setDestOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [destOpen]);

  // Measure the trigger so the portaled menu sits beside it, sized to the
  // available viewport space (flipping above when there's more room there).
  const openDestMenu = () => {
    if (destRef.current) {
      const r = destRef.current.getBoundingClientRect();
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      const placeAbove = spaceBelow < 240 && spaceAbove > spaceBelow;
      // Keep the menu compact (it scrolls internally) but never taller than the
      // space available on the chosen side.
      const CAP = 340;
      setDestMenuPos(
        placeAbove
          ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(spaceAbove, CAP) }
          : { left: r.left, width: r.width, top: r.bottom + 4, maxHeight: Math.min(spaceBelow, CAP) }
      );
    }
    setDestOpen(true);
  };

  // Auto-fill the Podcast Index submission URL from whichever hosted URL we have
  useEffect(() => {
    if (mode !== 'podcastIndex') return;
    if (podcastIndexSubmitUrl) return; // don't overwrite user edits
    const url = hostedUrl ?? stableUrl ?? nsiteUrl ?? '';
    if (url) setPodcastIndexSubmitUrl(url);
  }, [mode, hostedUrl, stableUrl, nsiteUrl, podcastIndexSubmitUrl]);

  // Check for existing hosted feed on mount, and apply pending credentials
  useEffect(() => {
    if (!currentFeedGuid) return;

    // Check for pending credentials from import
    const pending = pendingHostedStorage.load();
    if (pending) {
      // Only use pending credentials if they match the current feed's GUID
      if (pending.feedId === currentFeedGuid) {
        saveHostedFeedInfo(currentFeedGuid, pending);
        pendingHostedStorage.clear();
        setHostedInfo(pending);
        setHostedUrl(buildHostedUrl(pending.feedId));
        return;
      } else {
        // Pending credentials don't match current feed - discard them
        // (They're stale from a previous import, not a legacy migration)
        pendingHostedStorage.clear();
      }
    }

    const info = getHostedFeedInfo(currentFeedGuid);
    if (info) {
      // Check if feedId matches podcastGuid (legacy feeds may have different IDs)
      if (info.feedId === currentFeedGuid) {
        setHostedInfo(info);
        setIsDraft(info.isDraft === true);
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

    // Validate required fields only for publishing modes (not local/download/clipboard/podcastIndex)
    const requiresValidation = !['local', 'download', 'clipboard', 'podcastIndex'].includes(mode);
    if (requiresValidation) {
      const errors: string[] = [];

      if (isPublisherMode && publisherFeed) {
        // Publisher feed validation
        if (!publisherFeed.author?.trim()) errors.push('Artist Name');
        if (!publisherFeed.title?.trim()) errors.push('Catalog Title');
        if (!publisherFeed.description?.trim()) errors.push('Description');
        if (!publisherFeed.podcastGuid?.trim()) errors.push('Publisher GUID');
        // Every value recipient needs a non-zero split or its sats silently redistribute.
        errors.push(...getValueRecipientErrors(publisherFeed.value?.recipients, 'Value recipient'));
      } else {
        // Album validation
        // Nostr Music (kind 36787 / 34139) doesn't carry description, file size,
        // or require numeric duration — skip those so imported Nostr Music
        // albums can be re-published without adding fields the events don't use.
        const isNostrMusicMode = mode === 'nostrMusic';

        if (!album.author?.trim()) errors.push('Artist/Band');
        if (!album.title?.trim()) errors.push('Album Title');
        if (!isNostrMusicMode && !album.description?.trim()) errors.push('Description');
        if (!album.imageUrl?.trim()) errors.push('Album Art URL');
        if (!album.language?.trim()) errors.push('Language');
        if (!album.podcastGuid?.trim()) errors.push('Podcast GUID');

        // Feed-level value recipients: every one needs a non-zero split.
        errors.push(...getValueRecipientErrors(album.value?.recipients, 'Value recipient'));

        const itemLabel = isVideoMode ? 'Video' : 'Track';
        const urlLabel = isVideoMode ? 'Video URL' : 'MP3 URL';
        album.tracks.forEach((track, i) => {
          if (!track.title?.trim()) errors.push(`${itemLabel} ${i + 1} Title`);
          if (!isNostrMusicMode && !track.duration?.trim()) errors.push(`${itemLabel} ${i + 1} Duration`);
          if (!track.enclosureUrl?.trim()) errors.push(`${itemLabel} ${i + 1} ${urlLabel}`);
          if (!isNostrMusicMode && !track.enclosureLength?.trim()) errors.push(`${itemLabel} ${i + 1} File Size`);
          // Per-track value recipients (optional block, but if present each needs a split).
          errors.push(...getValueRecipientErrors(track.value?.recipients, `${itemLabel} ${i + 1} value recipient`));
        });
      }

      if (errors.length > 0) {
        setMessage({ type: 'error', text: `Missing required fields: ${errors.join(', ')}` });
        setLoading(false);
        return;
      }
    }

    // Pre-flight: verify signer is reachable before any Nostr operation.
    // For NIP-46 remote signers (Primal, Amber) this may require the user to approve
    // in their signer app — show a hint so they know to switch apps.
    const nostrSignModes = ['nostr', 'nostrMusic', 'blossom', 'nsite'] as const;
    // Hosted saves also sign with Nostr when the user is logged in with Nostr
    // (creating/claiming/updating an account-owned feed), so pre-flight those too.
    const hostedWillSignNostr = mode === 'hosted' && isLoggedIn && !!nostrState.user?.pubkey;
    if ((nostrSignModes as readonly string[]).includes(mode) || hostedWillSignNostr) {
      setMessage({ type: 'success', text: 'Connecting to signer — if using a remote signer (Primal, Amber), open the app and approve now.' });
      const health = await checkSignerConnection();
      setMessage(null);
      if (!health.connected) {
        setMessage({ type: 'error', text: health.error ?? 'Nostr signer is not connected.' });
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
          } else if (isVideoMode) {
            videoStorage.save(album);
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
        case 'nsite': {
          const nsiteFeed = isPublisherMode && publisherFeed ? publisherFeed : album;
          const nsiteFeedType = isPublisherMode ? 'publisher' as const : (feedType === 'video' ? 'video' as const : 'album' as const);
          const nsiteResult = await publishToNsite(
            nsiteFeed,
            nsiteFeedType,
            blossomServer,
            nsiteSiteId,
            (status) => setNsiteProgress(status)
          );
          if (nsiteResult.success) {
            if (nsiteResult.nsiteUrl) {
              setNsiteUrl(nsiteResult.nsiteUrl);
              // Submit to Podcast Index
              setNsiteProgress('Submitting to Podcast Index...');
              try {
                const piMedium = isPublisherMode ? publisherFeed?.medium : album.medium;
                const piParams = new URLSearchParams({ url: nsiteResult.nsiteUrl, guid: currentFeedGuid });
                if (piMedium) piParams.set('medium', piMedium);
                const piRes = await fetch(`/api/pubnotify?${piParams.toString()}`);
                if (piRes.ok) {
                  const piData = await piRes.json();
                  if (piData.podcastIndexUrl) setNsitePiUrl(piData.podcastIndexUrl);
                }
              } catch {
                // Non-fatal — feed is already published to nsite
              }
            }
            if (nsiteResult.blossomUrl) setNsiteBlossomUrl(nsiteResult.blossomUrl);
          }
          setNsiteProgress(null);
          setMessage({
            type: nsiteResult.success ? 'success' : 'error',
            text: nsiteResult.success
              ? nsiteResult.message + ' Feed submitted to Podcast Index.'
              : nsiteResult.message
          });
          break;
        }
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
            // Saving changes to an existing hosted feed now requires being signed in.
            // The edit token alone no longer authorizes an update here.
            const nostrAvailable = isLoggedIn && !!nostrState.user?.pubkey;
            const emailAvailable = isEmailLoggedIn();
            if (!nostrAvailable && !emailAvailable) {
              setMessage({ type: 'error', text: 'Sign in with email or Nostr to save changes to your hosted feed.' });
              setLoading(false);
              return;
            }

            // Pick the update path by which identity actually OWNS the feed
            // (matching the server's auth ladder) — a feed claimed by email must
            // update via the email session even if the user is also Nostr-logged-in,
            // and vice versa. Only unclaimed feeds fall back to the login method.
            const useNostr = isNostrLinked ? true : isEmailLinked ? false : nostrAvailable;
            const useEmail = !useNostr && emailAvailable;

            // If the feed is still token-owned, saving auto-claims it onto the
            // signed-in account (best-effort) so the token is retired going forward.
            let claimed: 'nostr' | 'email' | null = null;
            if (useNostr && !isNostrLinked && hostedInfo.editToken) {
              try {
                await linkNostrToFeed(hostedInfo.feedId, hostedInfo.editToken);
                claimed = 'nostr';
              } catch (claimErr) {
                console.warn('Auto-claim to Nostr failed:', claimErr);
              }
            } else if (useEmail && !isEmailLinked && hostedInfo.editToken) {
              try {
                await linkEmailToFeed(hostedInfo.feedId, hostedInfo.editToken);
                claimed = 'email';
              } catch (claimErr) {
                console.warn('Auto-claim to email failed:', claimErr);
              }
            }

            let updateResult;
            try {
              updateResult = useNostr
                ? await updateHostedFeedWithNostr(hostedInfo.feedId, hostedXml, currentFeedTitle, isDraft)
                : await updateHostedFeedWithEmail(hostedInfo.feedId, hostedXml, currentFeedTitle, isDraft);
            } catch (updateErr) {
              // The account-owned path can fail while a valid edit token is in hand:
              // the auto-claim above failed (signer rejected, network blip), the feed
              // predates .meta.json (PATCH 404s, PUT demands the raw token), or the
              // claim's metadata write hasn't propagated yet. Fall back to the token
              // so a legitimate token holder can always save.
              if (!hostedInfo.editToken) throw updateErr;
              console.warn('Account-owned update failed, retrying with edit token:', updateErr);
              updateResult = await updateHostedFeed(hostedInfo.feedId, hostedInfo.editToken, hostedXml, currentFeedTitle, isDraft);
            }
            const updatedInfo: HostedFeedInfo = {
              ...hostedInfo,
              lastUpdated: Date.now(),
              isDraft: updateResult.isDraft || undefined,
              ...(claimed === 'nostr' ? { ownerPubkey: nostrState.user!.pubkey, linkedAt: Date.now() } : {}),
              ...(claimed === 'email' ? { ownerEmailHash: getEmailSession()?.emailHash, emailLinkedAt: Date.now() } : {}),
            };
            saveHostedFeedInfo(currentFeedGuid, updatedInfo);
            setHostedInfo(updatedInfo);

            // Show PI notification result
            if (isDraft) {
              showSuccessAndClose('Feed updated as draft!');
            } else if (updateResult.podcastIndexId) {
              setPodcastIndexPending(true);
              setMessage({ type: 'success', text: 'Feed updated! Podcast Index notified.' });
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
            const shouldLinkEmail = !shouldLinkNostr && isEmailLoggedIn();
            if (shouldLinkNostr) {
              hostedResult = await createHostedFeedWithNostr(hostedXml, currentFeedTitle, currentFeedGuid, tokenToUse, isDraft);
              newInfo = {
                feedId: hostedResult.feedId,
                editToken: tokenToUse,
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                ownerPubkey: nostrState.user!.pubkey,
                linkedAt: Date.now(),
                ...(hostedResult.isDraft && { isDraft: true })
              };
            } else if (shouldLinkEmail) {
              hostedResult = await createHostedFeedWithEmail(hostedXml, currentFeedTitle, currentFeedGuid, tokenToUse, isDraft);
              newInfo = {
                feedId: hostedResult.feedId,
                editToken: tokenToUse,
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                ownerEmailHash: getEmailSession()?.emailHash,
                emailLinkedAt: Date.now(),
                ...(hostedResult.isDraft && { isDraft: true })
              };
            } else {
              hostedResult = await createHostedFeed(hostedXml, currentFeedTitle, currentFeedGuid, tokenToUse, isDraft);
              newInfo = {
                feedId: hostedResult.feedId,
                editToken: tokenToUse,
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                ...(hostedResult.isDraft && { isDraft: true })
              };
            }
            saveHostedFeedInfo(currentFeedGuid, newInfo);
            setHostedInfo(newInfo);
            setHostedUrl(buildHostedUrl(hostedResult.feedId));
            setPendingToken(null);
            setLegacyHostedInfo(null);

            if (isDraft) {
              setMessage({ type: 'success', text: 'Feed saved as draft! Podcast Index not notified.' });
            } else {
              // Build success message with PI result
              let successMsg = legacyHostedInfo
                ? 'Feed migrated to new URL and legacy URL updated!'
                : (shouldLinkNostr
                    ? 'Feed created and linked to your Nostr identity!'
                    : (shouldLinkEmail ? 'Feed created and linked to your email!' : 'Feed created!'));

              if (hostedResult.podcastIndexId) {
                setPodcastIndexPending(true);
                successMsg += ' Podcast Index notified.';
              }
              setMessage({ type: 'success', text: successMsg });
            }
          }
          break;
        case 'podcastIndex': {
          const submitUrl = podcastIndexSubmitUrl.trim();
          if (!submitUrl) {
            setMessage({ type: 'error', text: 'Feed URL is required' });
            setLoading(false);
            return;
          }
          if (podcastIndexUrlError) {
            setMessage({ type: 'error', text: podcastIndexUrlError });
            setLoading(false);
            return;
          }
          setPodcastIndexResultUrl(null);
          const params = new URLSearchParams({ url: submitUrl });
          if (currentFeedGuid) params.set('guid', currentFeedGuid);
          const piMedium = isPublisherMode ? publisherFeed?.medium : album.medium;
          if (piMedium) params.set('medium', piMedium);
          const response = await fetch(`/api/pubnotify?${params}`);
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            setMessage({ type: 'error', text: (data as { error?: string }).error ?? 'Failed to submit to Podcast Index' });
            setLoading(false);
            return;
          }
          if ((data as { podcastIndexUrl?: string }).podcastIndexUrl) {
            setPodcastIndexResultUrl((data as { podcastIndexUrl: string }).podcastIndexUrl);
            setMessage({ type: 'success', text: 'Feed added to Podcast Index!' });
          } else {
            setPodcastIndexResultUrl(`https://podcastindex.org/search?q=${encodeURIComponent(submitUrl)}`);
            setMessage({ type: 'success', text: 'Feed submitted! It may take a moment to appear in the index.' });
          }
          break;
        }
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

    const health = await checkSignerConnection();
    if (!health.connected) {
      setMessage({ type: 'error', text: health.error ?? 'Nostr signer is not connected.' });
      setLinkingNostr(false);
      return;
    }

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

  // Claim an existing feed with email. If already signed in with email, link directly;
  // otherwise open the email modal in claim mode (sends a confirmation link).
  const handleLinkEmail = async () => {
    if (!hostedInfo) return;

    if (!isEmailLoggedIn()) {
      setEmailModal({ mode: 'claim' });
      return;
    }

    setLinkingEmail(true);
    setMessage(null);
    try {
      await linkEmailToFeed(hostedInfo.feedId, hostedInfo.editToken);
      const session = getEmailSession();
      const updatedInfo = {
        ...hostedInfo,
        ownerEmailHash: session?.emailHash,
        emailLinkedAt: Date.now()
      };
      saveHostedFeedInfo(currentFeedGuid, updatedInfo);
      setHostedInfo(updatedInfo);
      setMessage({ type: 'success', text: 'Email linked! You can manage this feed from any device.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to link email' });
    } finally {
      setLinkingEmail(false);
    }
  };

  // Which destinations are visible given login / publisher / experimental state.
  const isDestinationVisible = (value: SaveMode): boolean => {
    if (value === 'nostrMusic') return !isPublisherMode && isLoggedIn;
    if (value === 'nostr' || value === 'blossom' || value === 'nsite') return showExperimental && isLoggedIn;
    return true;
  };
  const visibleDestinations = SAVE_DESTINATIONS.filter((d) => isDestinationVisible(d.value));
  const selectedDestination = SAVE_DESTINATIONS.find((d) => d.value === mode) ?? SAVE_DESTINATIONS[0];

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
              role="button"
              aria-label="Show save type descriptions"
            >
              i
            </span>
          </div>
        }
        footer={
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isButtonDisabled()}
            >
              {getButtonText()}
            </button>
            {mode === 'nostrMusic' && (
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!confirm('Request deletion of all published tracks and playlist for this album from Nostr relays?')) return;
                  setLoading(true);
                  setMessage(null);
                  const result = await deleteNostrMusicTracks(album);
                  setLoading(false);
                  setMessage({ type: result.success ? 'success' : 'error', text: result.message });
                }}
                disabled={loading}
                style={{ color: 'var(--error)' }}
              >
                Unpublish (delete)
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
          </div>
        }
      >
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" id="save-dest-label">Save Destination</label>
            <div className="save-dest" ref={destRef}>
              <button
                type="button"
                className="save-dest-trigger"
                aria-haspopup="listbox"
                aria-expanded={destOpen}
                aria-labelledby="save-dest-label"
                onClick={() => (destOpen ? setDestOpen(false) : openDestMenu())}
                onKeyDown={(e) => { if (e.key === 'Escape') setDestOpen(false); }}
              >
                <span className="save-dest-trigger-text">
                  <span className="label">{selectedDestination.label}{selectedDestination.experimental ? ' 🧪' : ''}</span>
                  <span className="blurb">{selectedDestination.blurb}</span>
                </span>
                <span className="save-dest-caret" aria-hidden="true">▾</span>
              </button>
              {destOpen && destMenuPos && createPortal(
                <ul
                  ref={destMenuRef}
                  className="save-dest-menu"
                  role="listbox"
                  aria-labelledby="save-dest-label"
                  style={{ top: destMenuPos.top, bottom: destMenuPos.bottom, left: destMenuPos.left, width: destMenuPos.width, maxHeight: destMenuPos.maxHeight }}
                >
                  {visibleDestinations.map((d) => (
                    <li
                      key={d.value}
                      role="option"
                      aria-selected={d.value === mode}
                      tabIndex={0}
                      className={`save-dest-option${d.value === mode ? ' selected' : ''}`}
                      onClick={() => { setMode(d.value); setDestOpen(false); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode(d.value); setDestOpen(false); }
                        else if (e.key === 'Escape') setDestOpen(false);
                      }}
                    >
                      <span className="save-dest-option-text">
                        <span className="label">{d.label}{d.experimental ? ' 🧪' : ''}</span>
                        <span className="blurb">{d.blurb}</span>
                      </span>
                      {d.value === mode && <span className="save-dest-check" aria-hidden="true">✓</span>}
                    </li>
                  ))}
                </ul>,
                document.body
              )}
            </div>
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
                <h3>{album.title || (isVideoMode ? 'Untitled Video Feed' : 'Untitled Album')}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {album.author || 'No author'} &bull; {album.tracks.length} {isVideoMode ? 'video' : 'track'}{album.tracks.length !== 1 ? 's' : ''}
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
                Upload your RSS feed to a Blossom server. Get a permanent MSP-hosted URL for podcast apps that always resolves to your latest upload.
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
          {mode === 'nsite' && (
            <div style={{ marginTop: '16px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
                Publish your feed as a decentralized nsite (NIP-5A) — experimental. Uploads to Blossom and creates a Nostr site manifest, reachable through any nsite gateway.
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
              {nsiteProgress && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '12px' }}>
                  {nsiteProgress}
                </p>
              )}
              {nsiteUrl && (
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--success)' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                    nsite Feed URL
                  </label>
                  <input
                    type="text"
                    value={nsiteUrl}
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
                    This URL serves your feed through the nsite.lol gateway. It may take a moment for gateways to pick up the manifest.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (nsiteUrl) {
                        navigator.clipboard.writeText(nsiteUrl);
                        setMessage({ type: 'success', text: 'nsite URL copied to clipboard' });
                      }
                    }}
                  >
                    Copy nsite URL
                  </button>
                </div>
              )}
              {nsiteBlossomUrl && (
                <div style={{ marginTop: '8px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Direct Blossom URL (changes with each update)
                  </label>
                  <input
                    type="text"
                    value={nsiteBlossomUrl}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              )}
              {nsitePiUrl && (
                <div style={{ marginTop: '8px' }}>
                  <a
                    href={nsitePiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.875rem', color: 'var(--accent-color)' }}
                  >
                    View on Podcast Index →
                  </a>
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
                    : isEmailLoggedIn()
                      ? 'Host your RSS feed on MSP — it will be owned by your email account, manageable from any device.'
                      : isLoggedIn
                        ? 'Host your RSS feed on MSP — it will be linked to your Nostr identity, manageable from any device.'
                        : 'Host your RSS feed on MSP — get a permanent URL for any podcast app.'}
              </p>
              {/* Updating an existing (e.g. imported token-owned or legacy) feed now requires signing in. */}
              {(hostedInfo || legacyHostedInfo) && !isLoggedIn && !isEmailLoggedIn() && (
                <SignInPrompt
                  style={{ marginTop: '12px' }}
                  title="Sign in to save changes"
                  blurb="Saving updates to an MSP-hosted feed requires signing in. If this feed used an edit token, signing in claims it to your account so you won't need the token again."
                  onEmail={() => setEmailModal({ mode: 'login' })}
                  onNostr={() => setShowNostrConnect(true)}
                />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem', marginTop: '12px' }}>
                <input
                  type="checkbox"
                  checked={isDraft}
                  onChange={(e) => setIsDraft(e.target.checked)}
                  style={{ width: '16px', height: '16px' }}
                />
                <span>Draft mode — host feed without notifying Podcast Index or sending podping</span>
              </label>
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
              {/* Logged-out users must sign in to host a NEW feed. Tokens are no longer offered for new feeds. */}
              {!hostedInfo && !legacyHostedInfo && !isEmailLoggedIn() && !isLoggedIn && !showRestore && (
                <SignInPrompt
                  style={{ marginTop: '16px' }}
                  title="Sign in to host your feed"
                  blurb="Sign in with your email or Nostr so this feed is owned by your account — manage it from any device, nothing to keep safe."
                  onEmail={() => setEmailModal({ mode: 'login' })}
                  onNostr={() => setShowNostrConnect(true)}
                >
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.7rem', textDecoration: 'underline', cursor: 'pointer', marginTop: '10px', padding: 0 }}
                    onClick={() => { setPendingToken(null); setShowRestore(true); }}
                  >
                    Already have a feed with an edit token? Restore it
                  </button>
                </SignInPrompt>
              )}
              {/* Calm "owned by your account" note for signed-in users — no token to manage. */}
              {pendingToken && !hostedInfo && !legacyHostedInfo && (isEmailLoggedIn() || isLoggedIn) && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px solid var(--success, #10b981)' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--success, #10b981)', fontWeight: 600, margin: 0 }}>
                    {isEmailLoggedIn() ? '✉️ This feed will be owned by your email account.' : '🔑 This feed will be linked to your Nostr identity.'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '6px', marginBottom: 0 }}>
                    You can manage it from any device — nothing to keep safe.
                  </p>
                </div>
              )}
              {/* New feeds no longer show an edit-token panel — a signed-in identity (email/Nostr) owns the feed. */}
              {hostedUrl && (
                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--success)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--success)' }}>
                    Your Feed URL
                    {isNostrLinked && (
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', borderRadius: '4px' }}>
                        Linked to Nostr
                      </span>
                    )}
                    {hostedInfo?.isDraft && (
                      <span style={{ fontSize: '0.7rem', padding: '2px 6px', backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', borderRadius: '4px' }}>
                        DRAFT
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
                  {podcastIndexPending && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Podcast Index
                      </label>
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
                    </div>
                  )}
                  {/* Token-owned feed (e.g. just restored): offer to switch it to an account so the token isn't needed. */}
                  {hostedInfo && !isNostrLinked && !isEmailLinked && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                        Switch this feed to your account
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        Link your email or Nostr so you can manage this feed from any device — no token to keep safe.
                      </p>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem' }}
                          onClick={handleLinkEmail}
                          disabled={linkingEmail}
                        >
                          {linkingEmail ? 'Linking…' : (isEmailLoggedIn() ? 'Claim with Email' : 'Claim with Email…')}
                        </button>
                        {isLoggedIn ? (
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem' }}
                            onClick={handleLinkNostr}
                            disabled={linkingNostr}
                          >
                            {linkingNostr ? 'Linking…' : 'Link Nostr Identity'}
                          </button>
                        ) : (
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => setShowNostrConnect(true)}
                          >
                            Sign in with Nostr
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {isNostrLinked && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--success, #10b981)', margin: 0 }}>
                        🔑 Linked to your Nostr identity — manageable from any device.
                      </p>
                    </div>
                  )}
                  {isEmailLinked && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--success, #10b981)', margin: 0 }}>
                        ✉️ Claimed with your email — manageable from any device.
                      </p>
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
                Submit a feed URL to Podcast Index so it gets indexed and becomes discoverable in apps like Fountain, Castamatic, and others.
              </p>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Feed URL
              </label>
              <input
                type="text"
                value={podcastIndexSubmitUrl}
                onChange={(e) => setPodcastIndexSubmitUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: `1px solid ${podcastIndexUrlError ? 'var(--error, #ef4444)' : 'var(--border-color)'}`,
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  fontFamily: 'monospace'
                }}
              />
              {podcastIndexUrlError && (
                <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--error, #ef4444)' }}>
                  {podcastIndexUrlError}
                </div>
              )}
              {podcastIndexResultUrl && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid var(--success)'
                }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)' }}>
                    View on Podcast Index
                  </label>
                  <a
                    href={podcastIndexResultUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.875rem', color: '#3b82f6', wordBreak: 'break-all' }}
                  >
                    {podcastIndexResultUrl}
                  </a>
                </div>
              )}
              <div style={{ marginTop: '12px' }}>
                <a
                  href="https://podcastindex.org/add"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.75rem', color: '#3b82f6' }}
                >
                  Add feed manually on podcastindex.org →
                </a>
              </div>
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
                <li><strong>Host on MSP</strong> - Host your feed on MSP servers. Get a permanent URL for your RSS feed to use in any app. Requires signing in with email or Nostr so the feed is owned by your account and editable from any device. Enable "Draft mode" to host without notifying Podcast Index or sending a podping.</li>
                <li><strong>Submit to PodcastIndex</strong> - Submit a feed URL to Podcast Index so it gets indexed and becomes discoverable in apps like Fountain, Castamatic, and others.</li>
                <li><strong>Publish to Nostr Music</strong> - Publishes each track (kind 36787) and the playlist (kind 34139) as Nostr events for Nostr-native music apps like Sunami. Audio files must already be hosted somewhere - these events just point to them. Not a podcast RSS feed.</li>
                {showExperimental && <li><strong>Save RSS feed to Nostr 🧪</strong> - Stores the entire RSS XML inside a Nostr event (kind 30054) on your relays. Personal cross-device backup tied to your Nostr key. Not readable by podcast apps.</li>}
                {showExperimental && <li><strong>Publish RSS feed to a Blossom server 🧪</strong> - Uploads the RSS file to a Blossom server and registers a Nostr pointer (kind 1063) so MSP can serve a permanent URL. Subscribable in any podcast app.</li>}
                {showExperimental && <li><strong>Publish RSS feed to nsite 🧪</strong> - Uploads the RSS file to a Blossom server and publishes an nsite site manifest (NIP-5A). Reachable as a permanent web URL through any nsite gateway. Subscribable in podcast apps.</li>}
              </ul>
            </ModalWrapper>
      )}
      {emailModal && (
        <EmailLoginModal
          onClose={() => setEmailModal(null)}
          claim={emailModal.mode === 'claim' && hostedInfo
            ? { feedId: hostedInfo.feedId, editToken: hostedInfo.editToken, feedTitle: currentFeedTitle }
            : undefined}
        />
      )}
      {showNostrConnect && (
        <NostrConnectModal onClose={() => setShowNostrConnect(false)} />
      )}
    </>
  );
}
