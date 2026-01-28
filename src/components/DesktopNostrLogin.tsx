/**
 * Desktop Nostr Login Component
 *
 * Replaces the NIP-07 browser extension login for Tauri desktop builds.
 * Supports nsec and hex key input with optional encrypted key storage.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isTauri,
  loginWithNsec,
  loginWithHex,
  logout,
  getPubkey,
  checkStoredKey,
  unlockStoredKey,
  type NostrProfile,
  type StoredKeyInfo,
} from '../utils/tauriNostr';
import { extractErrorMessage } from '../utils/errorHandling';
import { KeyStorageModal, keyStorageModalStyles } from './modals/KeyStorageModal';

interface DesktopNostrLoginProps {
  onLogin?: (profile: NostrProfile) => void;
  onLogout?: () => void;
}

type ModalMode = 'save' | 'unlock' | 'manage' | null;

export function DesktopNostrLogin({ onLogin, onLogout }: DesktopNostrLoginProps) {
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [storedKeyInfo, setStoredKeyInfo] = useState<StoredKeyInfo | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [pendingNsec, setPendingNsec] = useState<string | null>(null);
  const [checkingStoredKey, setCheckingStoredKey] = useState(true);

  // Check for existing session and stored key on mount
  useEffect(() => {
    if (!isTauri()) {
      setCheckingStoredKey(false);
      return;
    }

    const init = async () => {
      try {
        // First check if already logged in
        const existingProfile = await getPubkey();
        if (existingProfile) {
          setProfile(existingProfile);
          onLogin?.(existingProfile);
          setCheckingStoredKey(false);
          return;
        }

        // Check for stored key
        const keyInfo = await checkStoredKey();
        setStoredKeyInfo(keyInfo);

        if (keyInfo.exists) {
          if (keyInfo.mode === 'device') {
            // Auto-unlock for device mode
            try {
              const unlockedProfile = await unlockStoredKey();
              setProfile(unlockedProfile);
              onLogin?.(unlockedProfile);
            } catch {
              // Device key failed (maybe machine changed), show manual login
              setStoredKeyInfo({ ...keyInfo, exists: false });
            }
          } else {
            // Password mode - show unlock modal
            setModalMode('unlock');
          }
        }
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setCheckingStoredKey(false);
      }
    };

    init();
  }, [onLogin]);

  const refreshStoredKeyInfo = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const keyInfo = await checkStoredKey();
      setStoredKeyInfo(keyInfo);
    } catch (e) {
      console.error('Failed to check stored key:', e);
    }
  }, []);

  const handleLogin = async () => {
    if (!keyInput.trim()) {
      setError('Please enter a key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let result: NostrProfile;
      const trimmedKey = keyInput.trim();

      if (trimmedKey.startsWith('nsec1')) {
        result = await loginWithNsec(trimmedKey);
        // Store the nsec for potential saving
        setPendingNsec(trimmedKey);
      } else if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
        result = await loginWithHex(trimmedKey);
        // Can't offer to save hex keys as nsec
        setPendingNsec(null);
      } else {
        throw new Error('Invalid key format. Use nsec1... or 64-char hex.');
      }

      setProfile(result);
      setKeyInput('');
      setShowInput(false);
      onLogin?.(result);

      // Offer to save key if it was an nsec and no key is currently stored
      if (trimmedKey.startsWith('nsec1') && !storedKeyInfo?.exists) {
        setModalMode('save');
      }
    } catch (e) {
      setError(extractErrorMessage(e, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setProfile(null);
      setPendingNsec(null);
      onLogout?.();
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  const handleUnlock = (unlockedProfile: NostrProfile) => {
    setProfile(unlockedProfile);
    onLogin?.(unlockedProfile);
  };

  const handleKeySaved = () => {
    setPendingNsec(null);
    refreshStoredKeyInfo();
  };

  const handleKeyCleared = () => {
    refreshStoredKeyInfo();
  };

  const handleModalClose = () => {
    setModalMode(null);
    // Clear pending nsec if user skipped saving
    if (modalMode === 'save') {
      setPendingNsec(null);
    }
  };

  // Not in Tauri - return null or fallback to NIP-07 component
  if (!isTauri()) {
    return null;
  }

  // Still checking for stored key
  if (checkingStoredKey) {
    return (
      <div className="nostr-login">
        <span className="loading-text">Loading...</span>
      </div>
    );
  }

  // Logged in state
  if (profile) {
    return (
      <>
        <div className="nostr-login logged-in">
          <div className="profile-info">
            <span className="npub" title={profile.pubkey}>
              {profile.npub.slice(0, 12)}...{profile.npub.slice(-8)}
            </span>
            {storedKeyInfo?.exists && (
              <button
                className="manage-key-btn"
                onClick={() => setModalMode('manage')}
                title="Manage saved key"
              >
                &#9881;
              </button>
            )}
          </div>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>

        <KeyStorageModal
          isOpen={modalMode === 'manage'}
          onClose={handleModalClose}
          mode="manage"
          storedKeyInfo={storedKeyInfo || undefined}
          onKeySaved={handleKeySaved}
          onKeyCleared={handleKeyCleared}
        />
      </>
    );
  }

  // Login form
  return (
    <>
      <div className="nostr-login">
        {!showInput ? (
          <button onClick={() => setShowInput(true)} className="login-btn">
            Login with Nostr
          </button>
        ) : (
          <div className="login-form">
            <input
              type="password"
              placeholder="nsec1... or hex private key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              disabled={loading}
              autoFocus
            />
            <div className="login-actions">
              <button onClick={handleLogin} disabled={loading} className="submit-btn">
                {loading ? 'Connecting...' : 'Login'}
              </button>
              <button
                onClick={() => {
                  setShowInput(false);
                  setError(null);
                }}
                className="cancel-btn"
              >
                Cancel
              </button>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="security-note">
              Your key is encrypted and stored securely on this device.
            </div>
          </div>
        )}
      </div>

      {/* Unlock modal for password-protected stored key */}
      <KeyStorageModal
        isOpen={modalMode === 'unlock'}
        onClose={handleModalClose}
        mode="unlock"
        storedKeyInfo={storedKeyInfo || undefined}
        onUnlock={handleUnlock}
      />

      {/* Save modal after successful login */}
      <KeyStorageModal
        isOpen={modalMode === 'save'}
        onClose={handleModalClose}
        mode="save"
        nsecToStore={pendingNsec || undefined}
        onKeySaved={handleKeySaved}
      />
    </>
  );
}

// CSS styles (add to your App.css or create nostr-login.css)
export const nostrLoginStyles = `
${keyStorageModalStyles}

.nostr-login {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nostr-login.logged-in {
  gap: 1rem;
}

.nostr-login .loading-text {
  color: var(--text-secondary, #666);
  font-size: 0.9rem;
}

.nostr-login .profile-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nostr-login .npub {
  font-family: monospace;
  font-size: 0.85rem;
  color: #9b59b6;
  background: rgba(155, 89, 182, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.nostr-login .manage-key-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.25rem;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.nostr-login .manage-key-btn:hover {
  opacity: 1;
}

.nostr-login .login-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nostr-login input {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 0.9rem;
  width: 280px;
}

.nostr-login input:focus {
  outline: none;
  border-color: #9b59b6;
  box-shadow: 0 0 0 2px rgba(155, 89, 182, 0.2);
}

.nostr-login .login-actions {
  display: flex;
  gap: 0.5rem;
}

.nostr-login button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;
}

.nostr-login .login-btn,
.nostr-login .submit-btn {
  background: #9b59b6;
  color: white;
}

.nostr-login .login-btn:hover,
.nostr-login .submit-btn:hover {
  background: #8e44ad;
}

.nostr-login .logout-btn,
.nostr-login .cancel-btn {
  background: #e0e0e0;
  color: #333;
}

.nostr-login .logout-btn:hover,
.nostr-login .cancel-btn:hover {
  background: #d0d0d0;
}

.nostr-login button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nostr-login .error {
  color: #e74c3c;
  font-size: 0.85rem;
}

.nostr-login .security-note {
  font-size: 0.75rem;
  color: #666;
  margin-top: 0.25rem;
}
`;
