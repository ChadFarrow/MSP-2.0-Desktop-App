// MSP 2.0 - Music Side Project Studio
import { useState, useEffect, useRef } from 'react';
import { FeedProvider, useFeed } from './store/feedStore.tsx';
import type { FeedType } from './store/feedStore.tsx';
import { NostrProvider, useNostr } from './store/nostrStore.tsx';
import { ThemeProvider, useTheme } from './store/themeStore.tsx';
import { ExperimentalProvider, useExperimental } from './store/experimentalStore.tsx';
import { parseRssFeed, isPublisherFeed, isVideoFeed, parsePublisherRssFeed } from './utils/xmlParser';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyVideoAlbum } from './types/feed';
import { pendingHostedStorage } from './utils/storage';
import { generateTestAlbum } from './utils/testData';
import { regenerateAlbumGuids } from './utils/regenerateGuids';
import { NostrLoginButton } from './components/NostrLoginButton';
import { ImportModal } from './components/modals/ImportModal';
import { SaveModal } from './components/modals/SaveModal';
import { PreviewModal } from './components/modals/PreviewModal';
import { PodpingModal } from './components/modals/PodpingModal';
import { InfoModal } from './components/modals/InfoModal';
import { NostrConnectModal } from './components/modals/NostrConnectModal';
import { NewFeedChoiceModal } from './components/modals/NewFeedChoiceModal';
import { Editor } from './components/Editor/Editor';
import { PublisherEditor } from './components/Editor/PublisherEditor';
import { AdminPage } from './components/admin/AdminPage';
import type { Album } from './types/feed';
import mspLogo from './assets/msp-logo.png';
import './App.css';

// Main App Content (needs access to context)
function AppContent() {
  const { state, dispatch } = useFeed();
  const { theme, toggleTheme } = useTheme();
  const { showExperimental, toggleExperimental } = useExperimental();
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showPodpingModal, setShowPodpingModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showNostrConnectModal, setShowNostrConnectModal] = useState(false);
  const [showNewFeedChoiceModal, setShowNewFeedChoiceModal] = useState(false);
  const [pendingNewFeedType, setPendingNewFeedType] = useState<FeedType>('album');
  const [isTemplateMode, setIsTemplateMode] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { state: nostrState, logout: nostrLogout } = useNostr();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // regenerateGuids: used by the template/"duplicate this feed" flow so a new feed
  // gets fresh feed + per-track GUIDs instead of inheriting the source's identities.
  const handleImport = (xml: string, sourceUrl?: string, regenerateGuids = false) => {
    try {
      // Check if this is a publisher feed
      if (isPublisherFeed(xml)) {
        const publisherFeed = parsePublisherRssFeed(xml);
        // Attach source URL if provided (for auto-populating Publisher Feed URL field)
        if (sourceUrl) {
          publisherFeed.sourceUrl = sourceUrl;
        }
        // Only the feed GUID is renewed for templates — remoteItems reference real
        // external feeds and must keep their feedGuids.
        if (regenerateGuids) {
          publisherFeed.podcastGuid = crypto.randomUUID();
        }
        dispatch({ type: 'SET_PUBLISHER_FEED', payload: publisherFeed });
        return;
      }

      // Check if this is a video feed
      if (isVideoFeed(xml)) {
        const videoFeed = parseRssFeed(xml);
        dispatch({ type: 'SET_VIDEO_FEED', payload: regenerateGuids ? regenerateAlbumGuids(videoFeed) : videoFeed });
        return;
      }

      // Parse as regular album feed
      const album = parseRssFeed(xml);

      // Warn if not a music feed
      if (album.medium !== 'music') {
        const mediumMsg = album.medium
          ? `This feed has medium "${album.medium}" which is not a music feed.`
          : `This feed has no medium tag specified.`;
        const proceed = confirm(
          `${mediumMsg} MSP 2.0 is designed for music feeds. Continue anyway?`
        );
        if (!proceed) return;
        album.medium = 'music';
      }

      dispatch({ type: 'SET_ALBUM', payload: regenerateGuids ? regenerateAlbumGuids(album) : album });
    } catch (err) {
      alert('Failed to parse feed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleLoadAlbum = (album: Album) => {
    // Clear stale hosted credentials - Nostr/music imports don't use pending hosted storage
    pendingHostedStorage.clear();
    dispatch({ type: 'SET_ALBUM', payload: album });
  };

  const handleNew = (feedType: FeedType = 'album') => {
    setPendingNewFeedType(feedType);
    setShowNewFeedChoiceModal(true);
  };

  const handleStartBlank = () => {
    // Clear any stale hosted import credentials so they don't
    // accidentally overwrite a previously imported feed's content
    pendingHostedStorage.clear();
    if (pendingNewFeedType === 'publisher') {
      dispatch({ type: 'SET_PUBLISHER_FEED', payload: createEmptyPublisherFeed() });
    } else if (pendingNewFeedType === 'video') {
      dispatch({ type: 'SET_VIDEO_FEED', payload: createEmptyVideoAlbum() });
    } else {
      dispatch({ type: 'SET_ALBUM', payload: createEmptyAlbum() });
    }
    setShowNewFeedChoiceModal(false);
  };

  const handleUseTemplate = () => {
    setShowNewFeedChoiceModal(false);
    setIsTemplateMode(true);
    setShowImportModal(true);
  };

  const handleTemplateImport = (xml: string) => {
    // Import without sourceUrl so hosted link isn't set; regenerate feed + track
    // GUIDs so the template doesn't clone the source feed's track identities.
    handleImport(xml, undefined, true);
    pendingHostedStorage.clear();
  };

  const handleTemplateLoadAlbum = (album: Album) => {
    pendingHostedStorage.clear();
    dispatch({ type: 'SET_ALBUM', payload: regenerateAlbumGuids(album) });
  };

  const handleSwitchFeedType = (feedType: FeedType) => {
    dispatch({ type: 'SET_FEED_TYPE', payload: feedType });
    // If switching to video and no video feed exists, create one
    if (feedType === 'video' && !state.videoFeed) {
      dispatch({ type: 'CREATE_NEW_VIDEO_FEED' });
    }
    // If switching to publisher and no publisher feed exists, create one
    if (feedType === 'publisher' && !state.publisherFeed) {
      dispatch({ type: 'CREATE_NEW_PUBLISHER_FEED' });
    }
  };

  return (
    <>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <div className="header-title">
              <img src={mspLogo} alt="MSP Logo" className="header-logo" />
              <h1><span className="title-short">MSP 2.0</span><span className="title-full"> - Music Side Project Studio</span></h1>
            </div>
            {/* Feed Type Dropdown */}
            <select
              className="feed-type-select"
              value={state.feedType}
              onChange={(e) => handleSwitchFeedType(e.target.value as FeedType)}
            >
              <option value="album">Album</option>
              <option value="video">Video</option>
              <option value="publisher">Publisher</option>
            </select>
          </div>
          <div className="header-actions">
            <NostrLoginButton />
            <div className="header-dropdown" ref={dropdownRef}>
              <button
                className="btn btn-secondary btn-small dropdown-trigger"
                onClick={() => setShowDropdown(!showDropdown)}
                aria-expanded={showDropdown}
                aria-label="Menu"
              >
                ☰
              </button>
              {showDropdown && (
                <div className="dropdown-menu">
                  <button
                    className="dropdown-item"
                    onClick={() => { setShowInfoModal(true); setShowDropdown(false); }}
                  >
                    ℹ️ Info
                  </button>
                  <a
                    className="dropdown-item"
                    href="https://podtards.com/bae35f5f42e952ff9e3f9fa0fc4c6c0de179cce6a6e08dd1f4cc19d9b2120dfe.mp4"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowDropdown(false)}
                  >
                    🎬 Overview Video
                  </a>
                  <a
                    className="dropdown-item"
                    href="https://podtards.com/579676ff386928d3eb1275ead3d11be25200707dccc20f40ad95c3192f5faf0c.mp4"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowDropdown(false)}
                  >
                    🎬 Publisher Overview
                  </a>
                  <button
                    className="dropdown-item"
                    onClick={() => { toggleTheme(); setShowDropdown(false); }}
                  >
                    {theme === 'dark' ? '☀️' : '🌙'} Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
                  </button>
                  {/* Local dev only — gated on import.meta.env.DEV so the experimental
                      toggle is tree-shaken out of production builds */}
                  {import.meta.env.DEV && (
                    <button
                      className="dropdown-item"
                      onClick={() => { toggleExperimental(); setShowDropdown(false); }}
                    >
                      🧪 {showExperimental ? 'Hide' : 'Show'} Experimental Features
                    </button>
                  )}
                  <div className="dropdown-divider" />
                  {nostrState.isLoggedIn ? (
                    <button
                      className="dropdown-item"
                      onClick={() => { nostrLogout(); setShowDropdown(false); }}
                    >
                      🚪 Sign Out (nostr)
                    </button>
                  ) : (
                    <button
                      className="dropdown-item"
                      onClick={() => { setShowNostrConnectModal(true); setShowDropdown(false); }}
                    >
                      🔑 Sign In (nostr)
                    </button>
                  )}
                  {/* Local dev only — gated on import.meta.env.DEV so it is tree-shaken out of production builds */}
                  {import.meta.env.DEV && (
                    <>
                      <div className="dropdown-divider" />
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          dispatch({ type: 'SET_ALBUM', payload: generateTestAlbum() });
                          setShowDropdown(false);
                        }}
                      >
                        🧪 Load Test Data
                      </button>
                    </>
                  )}
                  <div className="dropdown-divider" />
                  <div className="dropdown-version">v{__APP_VERSION__}</div>
                </div>
              )}
            </div>
          </div>
        </header>
        {state.feedType === 'publisher' ? <PublisherEditor /> : <Editor key={`${state.feedType}-${state.album?.podcastGuid}-${state.videoFeed?.podcastGuid}`} />}
        <div className="bottom-toolbar">
          <button
            className="bottom-toolbar-btn"
            onClick={() => handleNew(state.feedType)}
            title={`New ${state.feedType === 'publisher' ? 'Publisher' : state.feedType === 'video' ? 'Video Feed' : 'Album'}`}
          >
            <span className="bottom-toolbar-icon">📂</span>
            <span className="bottom-toolbar-label">New</span>
          </button>
          <button
            className="bottom-toolbar-btn"
            onClick={() => setShowImportModal(true)}
            title="Import"
          >
            <span className="bottom-toolbar-icon">📥</span>
            <span className="bottom-toolbar-label">Import</span>
          </button>
          <button
            className="bottom-toolbar-btn"
            onClick={() => setShowSaveModal(true)}
            title="Save"
          >
            <span className="bottom-toolbar-icon">💾</span>
            <span className="bottom-toolbar-label">Save</span>
          </button>
          <button
            className="bottom-toolbar-btn"
            onClick={() => setShowPodpingModal(true)}
            title="Send Podping"
          >
            <span className="bottom-toolbar-icon">📡</span>
            <span className="bottom-toolbar-label">Podping</span>
          </button>
          <button
            className="bottom-toolbar-btn"
            onClick={() => setShowPreviewModal(true)}
            title="View Feed"
          >
            <span className="bottom-toolbar-icon">👁️</span>
            <span className="bottom-toolbar-label">View Feed</span>
          </button>
        </div>
      </div>

      {showImportModal && (
        <ImportModal
          onClose={() => { setShowImportModal(false); setIsTemplateMode(false); }}
          onImport={isTemplateMode ? handleTemplateImport : handleImport}
          onLoadAlbum={isTemplateMode ? handleTemplateLoadAlbum : handleLoadAlbum}
          isLoggedIn={nostrState.isLoggedIn}
          templateMode={isTemplateMode}
        />
      )}

      {showSaveModal && (
        <SaveModal
          onClose={() => setShowSaveModal(false)}
          album={state.feedType === 'video' && state.videoFeed ? state.videoFeed : state.album}
          publisherFeed={state.publisherFeed}
          feedType={state.feedType}
          isDirty={state.isDirty}
          isLoggedIn={nostrState.isLoggedIn}
          onImport={handleImport}
        />
      )}

      {showPreviewModal && (
        <PreviewModal
          onClose={() => setShowPreviewModal(false)}
          album={state.feedType === 'video' && state.videoFeed ? state.videoFeed : state.album}
          publisherFeed={state.publisherFeed}
          feedType={state.feedType}
        />
      )}

      {showPodpingModal && (
        <PodpingModal
          onClose={() => setShowPodpingModal(false)}
          feedGuid={
            state.feedType === 'publisher' && state.publisherFeed
              ? state.publisherFeed.podcastGuid
              : state.feedType === 'video' && state.videoFeed
                ? state.videoFeed.podcastGuid
                : state.album.podcastGuid
          }
          medium={
            state.feedType === 'publisher' && state.publisherFeed
              ? state.publisherFeed.medium
              : state.feedType === 'video' && state.videoFeed
                ? state.videoFeed.medium
                : state.album.medium
          }
        />
      )}

      {showInfoModal && (
        <InfoModal onClose={() => setShowInfoModal(false)} />
      )}

      {showNostrConnectModal && (
        <NostrConnectModal onClose={() => setShowNostrConnectModal(false)} />
      )}

      <NewFeedChoiceModal
        isOpen={showNewFeedChoiceModal}
        feedType={pendingNewFeedType}
        onStartBlank={handleStartBlank}
        onUseTemplate={handleUseTemplate}
        onCancel={() => setShowNewFeedChoiceModal(false)}
      />
    </>
  );
}

// Main App
function App() {
  const isAdminRoute = window.location.pathname === '/admin';

  if (isAdminRoute) {
    return (
      <ThemeProvider>
        <ExperimentalProvider>
          <NostrProvider>
            <AdminPage />
          </NostrProvider>
        </ExperimentalProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ExperimentalProvider>
        <NostrProvider>
          <FeedProvider>
            <AppContent />
          </FeedProvider>
        </NostrProvider>
      </ExperimentalProvider>
    </ThemeProvider>
  );
}

export default App;
