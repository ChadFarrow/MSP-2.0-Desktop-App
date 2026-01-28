// MSP 2.0 - Music Side Project Studio
import { useState, useEffect, useRef } from 'react';
import { FeedProvider, useFeed } from './store/feedStore.tsx';
import type { FeedType } from './store/feedStore.tsx';
import { NostrProvider, useNostr } from './store/nostrStore.tsx';
import { ThemeProvider, useTheme } from './store/themeStore.tsx';
import { parseRssFeed, isPublisherFeed, isVideoFeed, parsePublisherRssFeed } from './utils/xmlParser';
import { createEmptyAlbum, createEmptyPublisherFeed, createEmptyVideoAlbum } from './types/feed';
import { generateTestAlbum } from './utils/testData';
import { NostrLoginButton } from './components/NostrLoginButton';
import { ImportModal } from './components/modals/ImportModal';
import { SaveModal } from './components/modals/SaveModal';
import { PreviewModal } from './components/modals/PreviewModal';
import { InfoModal } from './components/modals/InfoModal';
import { NostrConnectModal } from './components/modals/NostrConnectModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { UpdateModal } from './components/modals/UpdateModal';
import { KeyStorageModal } from './components/modals/KeyStorageModal';
import { Editor } from './components/Editor/Editor';
import { checkForUpdate, isTauri } from './utils/updater';
import type { UpdateInfo } from './utils/updater';
import { PublisherEditor } from './components/Editor/PublisherEditor';
import { AdminPage } from './components/admin/AdminPage';
import { openUrl } from './utils/openUrl';
import type { Album } from './types/feed';
import {
  checkStoredKey,
  unlockStoredKey,
  type StoredKeyInfo,
  type NostrProfile,
} from './utils/tauriNostr';
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
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { state: nostrState, logout: nostrLogout, loginWithProfile } = useNostr();

  // Auto-unlock state for stored keys (desktop only)
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [storedKeyInfo, setStoredKeyInfo] = useState<StoredKeyInfo | null>(null);

  // Check for updates on launch (desktop only)
  useEffect(() => {
    if (!isTauri()) return;

    const checkUpdate = async () => {
      const update = await checkForUpdate();
      if (update) {
        setUpdateInfo(update);
        setShowUpdateModal(true);
      }
    };

    // Delay check by 2 seconds to let the app fully load
    const timer = setTimeout(checkUpdate, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Check for stored key on launch and auto-unlock (desktop only)
  useEffect(() => {
    if (!isTauri() || nostrState.isLoggedIn) return;

    const checkKey = async () => {
      try {
        const keyInfo = await checkStoredKey();
        setStoredKeyInfo(keyInfo);

        if (keyInfo.exists) {
          if (keyInfo.mode === 'device') {
            // Auto-unlock for device mode
            try {
              const profile = await unlockStoredKey();
              loginWithProfile(profile);
            } catch (e) {
              console.error('Auto-unlock failed:', e);
              // Device key failed, user will need to login manually
            }
          } else if (keyInfo.mode === 'password') {
            // Show unlock modal for password mode
            setShowUnlockModal(true);
          }
        }
      } catch (e) {
        console.error('Failed to check stored key:', e);
      }
    };

    checkKey();
  }, [nostrState.isLoggedIn, loginWithProfile]);

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
    dispatch({ type: 'SET_ALBUM', payload: album });
  };

  const handleNew = (feedType: FeedType = 'album') => {
    setPendingNewFeedType(feedType);
    setShowConfirmNewModal(true);
  };

  const handleConfirmNew = () => {
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
                  <button
                    className="dropdown-item"
                    onClick={() => { openUrl('https://podtards.com/bae35f5f42e952ff9e3f9fa0fc4c6c0de179cce6a6e08dd1f4cc19d9b2120dfe.mp4'); setShowDropdown(false); }}
                  >
                    🎬 Overview Video
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { openUrl('https://podtards.com/579676ff386928d3eb1275ead3d11be25200707dccc20f40ad95c3192f5faf0c.mp4'); setShowDropdown(false); }}
                  >
                    🎬 Publisher Overview
                  </button>
                  <button
                    className="dropdown-item"
                    onClick={() => { toggleTheme(); setShowDropdown(false); }}
                  >
                    {theme === 'dark' ? '☀️' : '🌙'} Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
                  </button>
                  {isTauri() && (
                    <button
                      className="dropdown-item"
                      onClick={async () => {
                        setShowDropdown(false);
                        const update = await checkForUpdate();
                        if (update) {
                          setUpdateInfo(update);
                          setShowUpdateModal(true);
                        } else {
                          alert('You are running the latest version!');
                        }
                      }}
                    >
                      🔄 Check for Updates
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

      {showUpdateModal && updateInfo && (
        <UpdateModal
          updateInfo={updateInfo}
          onClose={() => setShowUpdateModal(false)}
        />
      )}

      {/* Auto-unlock modal for stored keys (desktop only) */}
      <KeyStorageModal
        isOpen={showUnlockModal}
        onClose={() => setShowUnlockModal(false)}
        mode="unlock"
        storedKeyInfo={storedKeyInfo || undefined}
        onUnlock={(profile: NostrProfile) => {
          loginWithProfile(profile);
          setShowUnlockModal(false);
        }}
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
