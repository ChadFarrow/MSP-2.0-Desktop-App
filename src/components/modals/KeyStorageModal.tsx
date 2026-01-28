/**
 * Key Storage Modal
 *
 * Handles encrypted nsec storage for the desktop app.
 * Supports password-protected and device-only (passwordless) modes.
 */

import { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import {
  storeKeyWithPassword,
  storeKeyWithoutPassword,
  unlockStoredKey,
  clearStoredKey,
  changeKeyPassword,
  type StoredKeyInfo,
  type NostrProfile,
} from '../../utils/tauriNostr';
import { extractErrorMessage } from '../../utils/errorHandling';
import { hexToNpub } from '../../utils/nostr';
import { fetchNostrProfile } from '../../utils/nostrSync';

interface ProfileInfo {
  displayName?: string;
  picture?: string;
}

type ModalMode = 'save' | 'unlock' | 'manage';

interface KeyStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ModalMode;
  storedKeyInfo?: StoredKeyInfo;
  nsecToStore?: string;
  onUnlock?: (profile: NostrProfile) => void;
  onKeySaved?: () => void;
  onKeyCleared?: () => void;
}

export function KeyStorageModal({
  isOpen,
  onClose,
  mode,
  storedKeyInfo,
  nsecToStore,
  onUnlock,
  onKeySaved,
  onKeyCleared,
}: KeyStorageModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [usePassword, setUsePassword] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [profileInfo, setProfileInfo] = useState<ProfileInfo | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Fetch profile info when modal opens with a stored key
  useEffect(() => {
    if (!isOpen || !storedKeyInfo?.pubkey) {
      setProfileInfo(null);
      return;
    }

    const fetchProfile = async () => {
      setLoadingProfile(true);
      try {
        const profile = await fetchNostrProfile(storedKeyInfo.pubkey);
        if (profile) {
          setProfileInfo({
            displayName: profile.display_name || profile.name,
            picture: profile.picture,
          });
        }
      } catch (e) {
        console.error('Failed to fetch profile:', e);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [isOpen, storedKeyInfo?.pubkey]);

  const resetState = () => {
    setPassword('');
    setConfirmPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setError(null);
    setLoading(false);
    setShowClearConfirm(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSaveKey = async () => {
    if (!nsecToStore) {
      setError('No key to save');
      return;
    }

    if (usePassword) {
      if (!password) {
        setError('Please enter a password');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      if (usePassword) {
        await storeKeyWithPassword(nsecToStore, password);
      } else {
        await storeKeyWithoutPassword(nsecToStore);
      }
      onKeySaved?.();
      handleClose();
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to save key'));
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (storedKeyInfo?.mode === 'password' && !password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const profile = await unlockStoredKey(
        storedKeyInfo?.mode === 'password' ? password : undefined
      );
      onUnlock?.(profile);
      handleClose();
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to unlock key'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword && newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await changeKeyPassword(
        storedKeyInfo?.mode === 'password' ? password : undefined,
        newPassword || undefined
      );
      onKeySaved?.();
      handleClose();
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to change password'));
    } finally {
      setLoading(false);
    }
  };

  const handleClearKey = async () => {
    setLoading(true);
    setError(null);

    try {
      await clearStoredKey();
      onKeyCleared?.();
      handleClose();
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to clear key'));
    } finally {
      setLoading(false);
    }
  };

  const renderSaveMode = () => (
    <>
      <p className="modal-description">
        Save your private key for automatic login next time.
      </p>

      <div className="key-storage-option">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={usePassword}
            onChange={(e) => setUsePassword(e.target.checked)}
          />
          <span>Protect with password (recommended)</span>
        </label>
      </div>

      {usePassword ? (
        <>
          <div className="form-group">
            <label htmlFor="save-password">Password</label>
            <input
              id="save-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
            />
          </div>
        </>
      ) : (
        <div className="security-warning">
          <strong>Warning:</strong> Device-only protection is less secure.
          Anyone with access to this computer could potentially extract your key.
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="modal-actions">
        <button
          className="btn btn-primary"
          onClick={handleSaveKey}
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Key'}
        </button>
        <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
          Skip
        </button>
      </div>
    </>
  );

  const renderUnlockMode = () => (
    <>
      <p className="modal-description">
        {storedKeyInfo?.mode === 'device'
          ? 'Unlocking your saved key...'
          : 'Enter your password to unlock your saved key.'
        }
      </p>

      {storedKeyInfo?.pubkey && (
        <div className="stored-key-profile">
          {profileInfo?.picture ? (
            <img
              src={profileInfo.picture}
              alt=""
              className="profile-avatar"
            />
          ) : (
            <div className="profile-avatar-placeholder">
              {loadingProfile ? '...' : '?'}
            </div>
          )}
          <div className="profile-details">
            {profileInfo?.displayName && (
              <span className="profile-name">{profileInfo.displayName}</span>
            )}
            <code className="pubkey">
              {(() => {
                const npub = hexToNpub(storedKeyInfo.pubkey);
                return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
              })()}
            </code>
          </div>
        </div>
      )}

      {storedKeyInfo?.mode === 'password' && (
        <div className="form-group">
          <label htmlFor="unlock-password">Password</label>
          <input
            id="unlock-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            disabled={loading}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          />
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="modal-actions">
        <button
          className="btn btn-primary"
          onClick={handleUnlock}
          disabled={loading}
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
        <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
          Login Differently
        </button>
      </div>
    </>
  );

  const renderManageMode = () => (
    <>
      {!showClearConfirm ? (
        <>
          <div className="stored-key-info">
            <div className="info-row">
              <span className="label">Key:</span>
              <code className="pubkey">
                {storedKeyInfo?.pubkey && (() => {
                  const npub = hexToNpub(storedKeyInfo.pubkey);
                  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
                })()}
              </code>
            </div>
            <div className="info-row">
              <span className="label">Protection:</span>
              <span className="value">
                {storedKeyInfo?.mode === 'password' ? 'Password protected' : 'Device-only'}
              </span>
            </div>
          </div>

          <h4>Change Protection</h4>

          {storedKeyInfo?.mode === 'password' && (
            <div className="form-group">
              <label htmlFor="current-password">Current Password</label>
              <input
                id="current-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter current password"
                disabled={loading}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="new-password">New Password (leave empty for device-only)</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              disabled={loading}
            />
          </div>

          {newPassword && (
            <div className="form-group">
              <label htmlFor="confirm-new-password">Confirm New Password</label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
                disabled={loading}
              />
            </div>
          )}

          {!newPassword && storedKeyInfo?.mode === 'password' && (
            <div className="security-warning">
              Leaving password empty will switch to device-only protection.
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={handleChangePassword}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Update Protection'}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => setShowClearConfirm(true)}
              disabled={loading}
            >
              Clear Saved Key
            </button>
            <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="security-warning">
            Are you sure you want to remove your saved key?
            You will need to enter your nsec again to login.
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn btn-danger"
              onClick={handleClearKey}
              disabled={loading}
            >
              {loading ? 'Clearing...' : 'Yes, Clear Key'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowClearConfirm(false)}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );

  const getTitle = () => {
    switch (mode) {
      case 'save':
        return 'Save Key for Next Time?';
      case 'unlock':
        return 'Unlock Saved Key';
      case 'manage':
        return 'Manage Saved Key';
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={handleClose}
      title={getTitle()}
      className="key-storage-modal"
    >
      {mode === 'save' && renderSaveMode()}
      {mode === 'unlock' && renderUnlockMode()}
      {mode === 'manage' && renderManageMode()}
    </ModalWrapper>
  );
}

export const keyStorageModalStyles = `
.key-storage-modal .modal-description {
  margin-bottom: 1rem;
  color: var(--text-secondary, #666);
}

.key-storage-modal .key-storage-option {
  margin-bottom: 1rem;
}

.key-storage-modal .checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.key-storage-modal .checkbox-label input {
  width: auto;
}

.key-storage-modal .form-group {
  margin-bottom: 1rem;
}

.key-storage-modal .form-group label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.key-storage-modal .form-group input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  font-size: 0.9rem;
}

.key-storage-modal .form-group input:focus {
  outline: none;
  border-color: #9b59b6;
  box-shadow: 0 0 0 2px rgba(155, 89, 182, 0.2);
}

.key-storage-modal .security-warning {
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: #c0392b;
}

.key-storage-modal .error-message {
  color: #e74c3c;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}

.key-storage-modal .stored-key-info {
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 1rem;
}

.key-storage-modal .stored-key-info .info-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.key-storage-modal .stored-key-info .info-row:last-child {
  margin-bottom: 0;
}

.key-storage-modal .stored-key-info .label {
  font-weight: 500;
  min-width: 80px;
}

.key-storage-modal .stored-key-info .pubkey {
  font-family: monospace;
  font-size: 0.85rem;
  color: #9b59b6;
}

.key-storage-modal h4 {
  margin: 1rem 0 0.75rem;
  font-size: 1rem;
}

.key-storage-modal .modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.5rem;
  flex-wrap: wrap;
}

.key-storage-modal .btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background-color 0.2s;
}

.key-storage-modal .btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.key-storage-modal .btn-primary {
  background: #9b59b6;
  color: white;
}

.key-storage-modal .btn-primary:hover:not(:disabled) {
  background: #8e44ad;
}

.key-storage-modal .btn-secondary {
  background: var(--bg-secondary, #e0e0e0);
  color: var(--text-primary, #333);
}

.key-storage-modal .btn-secondary:hover:not(:disabled) {
  background: var(--bg-tertiary, #d0d0d0);
}

.key-storage-modal .btn-danger {
  background: #e74c3c;
  color: white;
}

.key-storage-modal .btn-danger:hover:not(:disabled) {
  background: #c0392b;
}
`;
