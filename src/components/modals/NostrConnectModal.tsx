import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useNostr } from '../../store/nostrStore';
import { hasNip07Extension } from '../../utils/nostrSigner';
import { ModalWrapper } from './ModalWrapper';
import {
  isTauri,
  loginWithNsec,
  loginWithHex,
  checkStoredKey,
  unlockStoredKey,
  type NostrProfile,
  type StoredKeyInfo,
} from '../../utils/tauriNostr';
import { KeyStorageModal } from './KeyStorageModal';
import { extractErrorMessage } from '../../utils/errorHandling';

interface NostrConnectModalProps {
  onClose: () => void;
}

type Tab = 'extension' | 'remote' | 'nsec';

export function NostrConnectModal({ onClose }: NostrConnectModalProps) {
  const { state, login, loginWithNip46, loginWithProfile } = useNostr();
  const [tab, setTab] = useState<Tab>(() => {
    // Default to nsec on Tauri, extension if available, otherwise remote
    if (isTauri()) return 'nsec';
    return hasNip07Extension() ? 'extension' : 'remote';
  });
  const [bunkerUri, setBunkerUri] = useState('');
  const [connectUri, setConnectUri] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Nsec login state
  const [nsecInput, setNsecInput] = useState('');
  const [storedKeyInfo, setStoredKeyInfo] = useState<StoredKeyInfo | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [pendingNsec, setPendingNsec] = useState<string | null>(null);
  const [checkingStoredKey, setCheckingStoredKey] = useState(isTauri());

  const hasExtension = hasNip07Extension();
  const isDesktop = isTauri();

  // Check for stored key on mount (Tauri only)
  useEffect(() => {
    if (!isDesktop) return;

    const checkKey = async () => {
      try {
        const keyInfo = await checkStoredKey();
        setStoredKeyInfo(keyInfo);

        if (keyInfo.exists) {
          if (keyInfo.mode === 'device') {
            // Try auto-unlock for device mode
            try {
              setConnecting(true);
              const profile = await unlockStoredKey();
              loginWithProfile(profile);
              onClose();
              return;
            } catch {
              // Device key failed, show manual login
              setStoredKeyInfo({ ...keyInfo, exists: false });
            } finally {
              setConnecting(false);
            }
          } else {
            // Password mode - show unlock modal
            setShowUnlockModal(true);
          }
        }
      } catch (e) {
        console.error('Failed to check stored key:', e);
      } finally {
        setCheckingStoredKey(false);
      }
    };

    checkKey();
  }, [isDesktop, loginWithProfile, onClose]);

  // Generate QR code when connectUri changes
  useEffect(() => {
    if (connectUri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, connectUri, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).catch(err => {
        console.error('Failed to generate QR code:', err);
      });
    }
  }, [connectUri]);

  // Close modal on successful login (but not if we're showing the save modal)
  useEffect(() => {
    if (state.isLoggedIn && !state.isLoading && !showSaveModal && !pendingNsec) {
      onClose();
    }
  }, [state.isLoggedIn, state.isLoading, onClose, showSaveModal, pendingNsec]);

  // Handle errors from state
  useEffect(() => {
    if (state.error) {
      setError(state.error);
      setConnecting(false);
    }
  }, [state.error]);

  const handleExtensionLogin = async () => {
    setError(null);
    setConnecting(true);
    try {
      await login();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setError('Please enter a bunker URI');
      return;
    }
    setError(null);
    setConnecting(true);
    try {
      await loginWithNip46(bunkerUri.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(false);
    }
  };

  const handleGenerateQR = async () => {
    setError(null);
    setConnecting(true);
    setConnectUri(null);

    try {
      await loginWithNip46(undefined, (uri) => {
        setConnectUri(uri);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(false);
    }
  };

  const handleCopyUri = async () => {
    if (connectUri) {
      try {
        await navigator.clipboard.writeText(connectUri);
      } catch {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = connectUri;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    }
  };

  const handleCancel = () => {
    setConnecting(false);
    setConnectUri(null);
    setError(null);
  };

  const handleNsecLogin = async () => {
    if (!nsecInput.trim()) {
      setError('Please enter your private key');
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      let profile: NostrProfile;
      const trimmedKey = nsecInput.trim();
      const isNsec = trimmedKey.startsWith('nsec1');
      const shouldOfferSave = isNsec && !storedKeyInfo?.exists;

      // Set pendingNsec BEFORE login so the useEffect doesn't auto-close
      if (shouldOfferSave) {
        setPendingNsec(trimmedKey);
      }

      if (isNsec) {
        profile = await loginWithNsec(trimmedKey);
      } else if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
        profile = await loginWithHex(trimmedKey);
      } else {
        throw new Error('Invalid key format. Use nsec1... or 64-character hex.');
      }

      setNsecInput('');
      loginWithProfile(profile);

      // Show save modal or close
      if (shouldOfferSave) {
        setShowSaveModal(true);
      } else {
        onClose();
      }
    } catch (e) {
      setPendingNsec(null);
      setError(extractErrorMessage(e, 'Login failed'));
    } finally {
      setConnecting(false);
    }
  };

  const handleUnlock = (profile: NostrProfile) => {
    loginWithProfile(profile);
    setShowUnlockModal(false);
    onClose();
  };

  const handleUnlockModalClose = () => {
    setShowUnlockModal(false);
    // Stay on modal so user can enter nsec manually
  };

  const handleSaveModalClose = () => {
    setShowSaveModal(false);
    setPendingNsec(null);
    onClose();
  };

  const handleKeySaved = async () => {
    setPendingNsec(null);
    // Refresh stored key info
    try {
      const keyInfo = await checkStoredKey();
      setStoredKeyInfo(keyInfo);
    } catch {
      // Ignore
    }
    onClose();
  };

  // Show loading while checking for stored key
  if (checkingStoredKey) {
    return (
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title="Sign in with Nostr"
        className="nostr-connect-modal"
      >
        <div className="nostr-connect-loading">
          <p>Checking for saved key...</p>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <>
      <ModalWrapper
        isOpen={true}
        onClose={onClose}
        title="Sign in with Nostr"
        className="nostr-connect-modal"
        footer={
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        }
      >
        <div className="modal-tabs">
          {isDesktop && (
            <button
              className={`modal-tab ${tab === 'nsec' ? 'active' : ''}`}
              onClick={() => { setTab('nsec'); setError(null); setConnectUri(null); }}
            >
              Private Key
            </button>
          )}
          <button
            className={`modal-tab ${tab === 'extension' ? 'active' : ''}`}
            onClick={() => { setTab('extension'); setError(null); setConnectUri(null); }}
          >
            Browser Extension
          </button>
          <button
            className={`modal-tab ${tab === 'remote' ? 'active' : ''}`}
            onClick={() => { setTab('remote'); setError(null); setConnectUri(null); }}
          >
            Remote Signer
          </button>
        </div>

        {tab === 'nsec' && isDesktop ? (
          <div className="nostr-connect-nsec">
            <p className="connect-description">
              Enter your Nostr private key (nsec) to sign in. Your key will be encrypted and stored securely on this device.
            </p>

            {storedKeyInfo?.exists && (
              <div className="stored-key-notice">
                <p>You have a saved key. <button className="link-btn" onClick={() => setShowUnlockModal(true)}>Unlock it</button></p>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="nsec-input">Private Key</label>
              <input
                id="nsec-input"
                type="password"
                className="form-input"
                placeholder="nsec1... or hex private key"
                value={nsecInput}
                onChange={e => setNsecInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNsecLogin()}
                disabled={connecting}
                autoFocus
              />
            </div>

            <button
              className="btn btn-primary btn-large"
              onClick={handleNsecLogin}
              disabled={connecting || !nsecInput.trim()}
            >
              {connecting ? 'Connecting...' : 'Sign In'}
            </button>

            <div className="security-note">
              Your private key is encrypted with XChaCha20-Poly1305 and never leaves this device.
            </div>
          </div>
        ) : tab === 'extension' ? (
          <div className="nostr-connect-extension">
              <p className="connect-description">
                Connect using a NIP-07 browser extension like Alby, nos2x, or Nostr Connect.
              </p>

              {!hasExtension && (
                <div className="connect-warning">
                  No Nostr extension detected. Install one to use this method, or use Remote Signer for mobile.
                </div>
              )}

              <button
                className="btn btn-primary btn-large"
                onClick={handleExtensionLogin}
                disabled={!hasExtension || connecting}
              >
                {connecting ? 'Connecting...' : 'Connect with Extension'}
              </button>
            </div>
          ) : (
            <div className="nostr-connect-remote">
              {!connectUri ? (
                <>
                  <p className="connect-description">
                    Connect using a remote signer like Amber (Android), Nostr Signer (iOS), or any NIP-46 compatible app.
                  </p>

                  <div className="connect-option">
                    <h4>Option 1: Scan QR Code</h4>
                    <p>Generate a connection QR code to scan with your signer app.</p>
                    <button
                      className="btn btn-primary"
                      onClick={handleGenerateQR}
                      disabled={connecting}
                    >
                      {connecting ? 'Generating...' : 'Generate QR Code'}
                    </button>
                  </div>

                  <div className="connect-divider">
                    <span>or</span>
                  </div>

                  <div className="connect-option">
                    <h4>Option 2: Paste Bunker URI</h4>
                    <p>Paste a bunker:// URI from your signer app.</p>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="bunker://..."
                      value={bunkerUri}
                      onChange={e => setBunkerUri(e.target.value)}
                      disabled={connecting}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleBunkerLogin}
                      disabled={connecting || !bunkerUri.trim()}
                      style={{ marginTop: '8px' }}
                    >
                      {connecting ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="connect-qr-container">
                  <p className="connect-description">
                    Scan this QR code with your Nostr signer app (Amber, etc.)
                  </p>

                  <div className="qr-code-wrapper">
                    <canvas ref={canvasRef} />
                  </div>

                  <p className="connect-waiting">
                    Waiting for connection...
                  </p>

                  <div className="connect-qr-actions">
                    <button className="btn btn-secondary" onClick={handleCopyUri}>
                      Copy URI
                    </button>
                    <button className="btn btn-secondary" onClick={handleCancel}>
                      Cancel
                    </button>
                  </div>

                  <details className="connect-uri-details">
                    <summary>Show connection URI</summary>
                    <code className="connect-uri-code">{connectUri}</code>
                  </details>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="connect-error">
              {error}
            </div>
          )}
      </ModalWrapper>

      {/* Unlock modal for password-protected stored key */}
      <KeyStorageModal
        isOpen={showUnlockModal}
        onClose={handleUnlockModalClose}
        mode="unlock"
        storedKeyInfo={storedKeyInfo || undefined}
        onUnlock={handleUnlock}
      />

      {/* Save modal after successful login */}
      <KeyStorageModal
        isOpen={showSaveModal}
        onClose={handleSaveModalClose}
        mode="save"
        nsecToStore={pendingNsec || undefined}
        onKeySaved={handleKeySaved}
      />
    </>
  );
}
