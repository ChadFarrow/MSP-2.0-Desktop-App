// MSP 2.0 - Music Side Project Studio
import { useState, useEffect, useRef } from 'react';
import { FeedProvider, useFeed } from './store/feedStore.tsx';
import type { FeedType } from './store/feedStore.tsx';
import { NostrProvider, useNostr } from './store/nostrStore.tsx';
import { ThemeProvider, useTheme } from './store/themeStore.tsx';
import { parseRssFeed, isPublisherFeed, isVideoFeed, parsePublisherRssFeed } from './utils/xmlParser';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyVideoAlbum } from './types/feed';
import { pendingHostedStorage } from './utils/storage';
import { generateTestAlbum } from './utils/testData';
import { NostrLoginButton } from './components/NostrLoginButton';
import { ImportModal } from './components/modals/ImportModal';
import { SaveModal } from './components/modals/SaveModal';
import { PreviewModal } from './components/modals/PreviewModal';
import { InfoModal } from './components/modals/InfoModal';
import { NostrConnectModal } from './components/modals/NostrConnectModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showNostrConnectModal, setShowNostrConnectModal] = useState(false);
  const [showConfirmNewModal, setShowConfirmNewModal] = useState(false);
  const [pendingNewFeedType, setPendingNewFeedType] = useState<FeedType>('album');
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

  const handleImport = (xml: string, sourceUrl?: string) => {
    try {
      // Check if this is a publisher feed
      if (isPublisherFeed(xml)) {
        const publisherFeed = parsePublisherRssFeed(xml);
        // Attach source URL if provided (for auto-populating Publisher Feed URL field)
        if (sourceUrl) {
          publisherFeed.sourceUrl = sourceUrl;
        }
        dispatch({ type: 'SET_PUBLISHER_FEED', payload: publisherFeed });
        return;
      }

      // Check if this is a video feed
      if (isVideoFeed(xml)) {
        const videoFeed = parseRssFeed(xml);
        dispatch({ type: 'SET_VIDEO_FEED', payload: videoFeed });
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

      dispatch({ type: 'SET_ALBUM', payload: album });
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
    setShowConfirmNewModal(true);
  };

  const handleConfirmNew = () => {
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
    setShowConfirmNewModal(false);
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
                    onClick={() => { handleNew(state.feedType); setShowDropdown(false); }}
                  >
                    📂 New {state.feedType === 'publisher' ? 'Publisher' : state.feedType === 'video' ? 'Video Feed' : 'Album'}
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setShowImportModal(true); setShowDropdown(false); }}
                  >
                    📥 Import
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setShowSaveModal(true); setShowDropdown(false); }}
                  >
                    💾 Save
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { setShowPreviewModal(true); setShowDropdown(false); }}
                  >
                    👁️ View Feed
                  </button>
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
                  <a
                    className="dropdown-item"
                    href="https://msp-2-0-git-fafo-chadfs-projects.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setShowDropdown(false)}
                  >
                    🧪 Experimental (FAFO)
                  </a>
                </div>
              )}
            </div>
          </div>
        </header>
        {state.feedType === 'publisher' ? <PublisherEditor /> : <Editor key={`${state.feedType}-${state.album?.podcastGuid}-${state.videoFeed?.podcastGuid}`} />}
      </div>

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImport={handleImport}
          onLoadAlbum={handleLoadAlbum}
          isLoggedIn={nostrState.isLoggedIn}
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

      {showInfoModal && (
        <InfoModal onClose={() => setShowInfoModal(false)} />
      )}

      {showNostrConnectModal && (
        <NostrConnectModal onClose={() => setShowNostrConnectModal(false)} />
      )}

      <ConfirmModal
        isOpen={showConfirmNewModal}
        title={pendingNewFeedType === 'publisher' ? 'Create New Publisher Feed' : pendingNewFeedType === 'video' ? 'Create New Video Feed' : 'Create New Album'}
        message={`Create a new ${pendingNewFeedType === 'publisher' ? 'Publisher Feed' : pendingNewFeedType === 'video' ? 'Video Feed' : 'Album'}? This will clear all current data for this feed type.`}
        confirmText="Create"
        cancelText="Cancel"
        variant="warning"
        onConfirm={handleConfirmNew}
        onCancel={() => setShowConfirmNewModal(false)}
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
        <NostrProvider>
          <AdminPage />
        </NostrProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <NostrProvider>
        <FeedProvider>
          <AppContent />
        </FeedProvider>
      </NostrProvider>
    </ThemeProvider>
  );
}

export default App;
