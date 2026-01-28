/**
 * Key Storage Modal
 *
 * Handles encrypted nsec storage for the desktop app.
 * Supports multiple keys with password-protected and device-only modes.
 */

import { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import {
  storeKeyWithPassword,
  storeKeyWithoutPassword,
  unlockStoredKey,
  removeStoredKey,
  changeKeyPassword,
  type StoredKeyInfo,
  type StoredKeyEntry,
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
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null);
  const [keyToRemove, setKeyToRemove] = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<Record<string, ProfileInfo>>({});
  const [loadingProfiles, setLoadingProfiles] = useState<Set<string>>(new Set());

  const keys = storedKeyInfo?.keys || [];
  const selectedKey = keys.find(k => k.pubkey === selectedPubkey) || keys[0];

  // Select first key by default
  useEffect(() => {
    if (isOpen && keys.length > 0 && !selectedPubkey) {
      setSelectedPubkey(keys[0].pubkey);
    }
  }, [isOpen, keys, selectedPubkey]);

  // Fetch profiles for all keys
  useEffect(() => {
    if (!isOpen) return;

    keys.forEach(async (key) => {
      if (profileCache[key.pubkey] || loadingProfiles.has(key.pubkey)) return;

      setLoadingProfiles(prev => new Set(prev).add(key.pubkey));
      try {
        const profile = await fetchNostrProfile(key.pubkey);
        if (profile) {
          setProfileCache(prev => ({
            ...prev,
            [key.pubkey]: {
              displayName: profile.display_name || profile.name,
              picture: profile.picture,
            },
          }));
        }
      } catch (e) {
        console.error('Failed to fetch profile:', e);
      } finally {
        setLoadingProfiles(prev => {
          const next = new Set(prev);
          next.delete(key.pubkey);
          return next;
        });
      }
    });
  }, [isOpen, keys, profileCache, loadingProfiles]);

  const resetState = () => {
    setPassword('');
    setConfirmPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setLabel('');
    setError(null);
    setLoading(false);
    setKeyToRemove(null);
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
        await storeKeyWithPassword(nsecToStore, password, label || undefined);
      } else {
        await storeKeyWithoutPassword(nsecToStore, label || undefined);
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
    if (!selectedKey) {
      setError('No key selected');
      return;
    }

    if (selectedKey.mode === 'password' && !password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const profile = await unlockStoredKey(
        selectedKey.pubkey,
        selectedKey.mode === 'password' ? password : undefined
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
    if (!selectedKey) return;

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
        selectedKey.pubkey,
        selectedKey.mode === 'password' ? password : undefined,
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

  const handleRemoveKey = async () => {
    if (!keyToRemove) return;

    setLoading(true);
    setError(null);

    try {
      await removeStoredKey(keyToRemove);
      setKeyToRemove(null);
      // Select another key if available
      const remaining = keys.filter(k => k.pubkey !== keyToRemove);
      if (remaining.length > 0) {
        setSelectedPubkey(remaining[0].pubkey);
      } else {
        setSelectedPubkey(null);
      }
      onKeyCleared?.();
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to remove key'));
    } finally {
      setLoading(false);
    }
  };

  const renderKeyItem = (key: StoredKeyEntry, selectable: boolean = false) => {
    const profile = profileCache[key.pubkey];
    const npub = hexToNpub(key.pubkey);
    const isSelected = key.pubkey === selectedPubkey;

    return (
      <div
        key={key.pubkey}
        className={`key-item ${selectable ? 'selectable' : ''} ${isSelected && selectable ? 'selected' : ''}`}
        onClick={selectable ? () => setSelectedPubkey(key.pubkey) : undefined}
      >
        {profile?.picture ? (
          <img src={profile.picture} alt="" className="key-avatar" />
        ) : (
          <div className="key-avatar-placeholder">
            {loadingProfiles.has(key.pubkey) ? '...' : '?'}
          </div>
        )}
        <div className="key-details">
          <span className="key-name">
            {key.label || profile?.displayName || 'Unnamed Key'}
          </span>
          <code className="key-npub">
            {npub.slice(0, 12)}...{npub.slice(-8)}
          </code>
          <span className="key-mode">
            {key.mode === 'password' ? '🔒 Password' : '💻 Device'}
          </span>
        </div>
      </div>
    );
  };

  const renderSaveMode = () => (
    <>
      <p className="modal-description">
        Save your private key for automatic login next time.
        {keys.length > 0 && ' This will be added to your existing saved keys.'}
      </p>

      <div className="form-group">
        <label htmlFor="key-label">Label (optional)</label>
        <input
          id="key-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., Main Account, Work, etc."
          disabled={loading}
        />
      </div>

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
        {keys.length > 1
          ? 'Select an account to sign in with.'
          : 'Enter your password to unlock your saved key.'}
      </p>

      {keys.length > 1 && (
        <div className="key-list">
          {keys.map(key => renderKeyItem(key, true))}
        </div>
      )}

      {keys.length === 1 && selectedKey && renderKeyItem(selectedKey)}

      {selectedKey?.mode === 'password' && (
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
          disabled={loading || !selectedKey}
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
        <button className="btn btn-secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </button>
      </div>
    </>
  );

  const renderManageMode = () => (
    <>
      {!keyToRemove ? (
        <>
          <p className="modal-description">
            Manage your saved keys ({keys.length} key{keys.length !== 1 ? 's' : ''}).
          </p>

          <div className="key-list">
            {keys.map(key => (
              <div key={key.pubkey} className="key-item-manage">
                {renderKeyItem(key)}
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => setKeyToRemove(key.pubkey)}
                  title="Remove key"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {keys.length === 0 && (
            <p className="no-keys">No saved keys.</p>
          )}

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={handleClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="security-warning">
            Are you sure you want to remove this key?
            You will need to enter the nsec again to use this account.
          </div>

          {keys.find(k => k.pubkey === keyToRemove) &&
            renderKeyItem(keys.find(k => k.pubkey === keyToRemove)!)}

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button
              className="btn btn-danger"
              onClick={handleRemoveKey}
              disabled={loading}
            >
              {loading ? 'Removing...' : 'Yes, Remove Key'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setKeyToRemove(null)}
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
        return keys.length > 1 ? 'Select Account' : 'Unlock Saved Key';
      case 'manage':
        return 'Manage Saved Keys';
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
