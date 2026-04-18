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
import { PodpingModal } from './components/modals/PodpingModal';
import { InfoModal } from './components/modals/InfoModal';
import { NostrConnectModal } from './components/modals/NostrConnectModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { UpdateModal } from './components/modals/UpdateModal';
import { KeyStorageModal } from './components/modals/KeyStorageModal';
import { Editor } from './components/Editor/Editor';
import { checkForUpdate, isTauri, getAppVersion } from './utils/updater';
import type { UpdateInfo } from './utils/updater';
import { PublisherEditor } from './components/Editor/PublisherEditor';
import { AdminPage } from './components/admin/AdminPage';
import { openUrl } from './utils/openUrl';
import type { Album } from './types/feed';
import {
  tryAutoUnlockStoredKey,
  checkStoredKey,
  type StoredKeyInfo,
  type NostrProfile,
} from './utils/tauriNostr';
import { FeedSidebar } from './components/FeedSidebar';
import { hasLocalStorage } from './utils/localFeedStorage';
import mspLogo from './assets/msp-logo.png';
import './App.css';

// Main App Content (needs access to context)
function AppContent() {
  const { state, dispatch } = useFeed();
  const { theme, toggleTheme } = useTheme();
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showPodpingModal, setShowPodpingModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showNostrConnectModal, setShowNostrConnectModal] = useState(false);
  const [showSwitchAccountModal, setShowSwitchAccountModal] = useState(false);
  const [switchStoredKeyInfo, setSwitchStoredKeyInfo] = useState<StoredKeyInfo | undefined>(undefined);
  const [switchFromPubkey, setSwitchFromPubkey] = useState<string | null>(null);
  const [showConfirmNewModal, setShowConfirmNewModal] = useState(false);
  const [pendingNewFeedType, setPendingNewFeedType] = useState<FeedType>('album');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { state: nostrState, logout: nostrLogout, loginWithProfile } = useNostr();

  // Sidebar state (desktop only)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentLocalFeedId, setCurrentLocalFeedId] = useState<string | undefined>(undefined);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const isDesktop = hasLocalStorage();

  // Auto-unlock state for stored keys (desktop only)
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [storedKeyInfo, setStoredKeyInfo] = useState<StoredKeyInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const hasCheckedStoredKey = useRef(false);

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

  // Get app version on launch (desktop only)
  useEffect(() => {
    getAppVersion().then(setAppVersion);
  }, []);

  // Check for stored key on launch and auto-unlock (desktop only)
  // Only runs once on mount - not when user signs out
  useEffect(() => {
    if (!isTauri() || nostrState.isLoggedIn || hasCheckedStoredKey.current) return;

    hasCheckedStoredKey.current = true;

    const checkKey = async () => {
      const result = await tryAutoUnlockStoredKey();
      setStoredKeyInfo(result.storedKeyInfo);

      if (result.success && result.profile) {
        loginWithProfile(result.profile);
      } else if (result.showUnlockModal) {
        setShowUnlockModal(true);
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

  const handleSidebarLoadFeed = (xml: string, id: string, feedType: 'album' | 'video' | 'publisher') => {
    if (state.isDirty) {
      const proceed = confirm('You have unsaved changes. Load this feed anyway?');
      if (!proceed) return;
    }
    handleImport(xml);
    setCurrentLocalFeedId(id);
    // Switch to correct feed type if needed
    if (feedType !== state.feedType) {
      handleSwitchFeedType(feedType);
    }
  };

  return (
    <>
      <div className="app">
        <header className="header">
          <div className="header-left">
            {isDesktop && (
              <button
                className={`sidebar-toggle${sidebarOpen ? ' active' : ''}`}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
                title="Toggle feed sidebar"
              >
                ☰
              </button>
            )}
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
                    onClick={() => { setShowPodpingModal(true); setShowDropdown(false); }}
                  >
                    📡 Send Podping
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
                        try {
                          const update = await checkForUpdate(true);
                          if (update) {
                            setUpdateInfo(update);
                            setShowUpdateModal(true);
                          } else {
                            alert('You are running the latest version!');
                          }
                        } catch (err) {
                          alert('Update check failed: ' + (err instanceof Error ? err.message : String(err)));
                        }
                      }}
                    >
                      🔄 Check for Updates
                    </button>
                  )}
                  <div className="dropdown-divider" />
                  {nostrState.isLoggedIn ? (
                    <>
                    <button
                      className="dropdown-item"
                      onClick={async () => {
                        setSwitchFromPubkey(nostrState.user?.pubkey ?? null);
                        setShowDropdown(false);
                        try {
                          const keyInfo = await checkStoredKey();
                          setSwitchStoredKeyInfo(keyInfo);
                          nostrLogout();
                          setShowSwitchAccountModal(true);
                        } catch {
                          // Fall back to full sign-in modal if key check fails
                          nostrLogout();
                          setShowNostrConnectModal(true);
                        }
                      }}
                    >
                      🔄 Switch Account
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => { nostrLogout(); setShowDropdown(false); }}
                    >
                      🚪 Sign Out (nostr)
                    </button>
                    </>
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
                  <div className="dropdown-version">v{appVersion ?? __APP_VERSION__}</div>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="app-body">
          {isDesktop && (
            <FeedSidebar
              isOpen={sidebarOpen}
              onLoadFeed={handleSidebarLoadFeed}
              onDeleteFeed={() => setCurrentLocalFeedId(undefined)}
              currentFeedId={currentLocalFeedId}
              refreshKey={sidebarRefreshKey}
            />
          )}
          <div className="app-content">
            {state.feedType === 'publisher' ? <PublisherEditor /> : <Editor key={`${state.feedType}-${state.album?.podcastGuid}-${state.videoFeed?.podcastGuid}`} />}
          </div>
        </div>
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
          currentLocalFeedId={currentLocalFeedId}
          onLocalFeedSaved={(id) => {
            setCurrentLocalFeedId(id);
            setSidebarRefreshKey(k => k + 1);
          }}
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
            state.feedType === 'publisher'
              ? undefined
              : state.feedType === 'video'
                ? 'video'
                : 'music'
          }
        />
      )}

      {showInfoModal && (
        <InfoModal onClose={() => setShowInfoModal(false)} />
      )}

      {showNostrConnectModal && (
        <NostrConnectModal onClose={() => { setShowNostrConnectModal(false); setSwitchFromPubkey(null); }} excludePubkey={switchFromPubkey ?? undefined} />
      )}

      <KeyStorageModal
        isOpen={showSwitchAccountModal}
        onClose={() => { setShowSwitchAccountModal(false); setSwitchFromPubkey(null); setSwitchStoredKeyInfo(undefined); }}
        mode="unlock"
        storedKeyInfo={switchStoredKeyInfo}
        excludePubkey={switchFromPubkey ?? undefined}
        onUnlock={(profile) => { loginWithProfile(profile); setShowSwitchAccountModal(false); setSwitchFromPubkey(null); setSwitchStoredKeyInfo(undefined); }}
      />

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
