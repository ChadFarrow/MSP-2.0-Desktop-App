/**
 * Desktop Nostr Login Component
 * 
 * Replaces the NIP-07 browser extension login for Tauri desktop builds.
 * Supports nsec and hex key input.
 */

import { useState, useEffect } from 'react';
import { 
  isTauri, 
  loginWithNsec, 
  loginWithHex, 
  logout, 
  getPubkey,
  type NostrProfile 
} from '../lib/tauri-nostr';

interface DesktopNostrLoginProps {
  onLogin?: (profile: NostrProfile) => void;
  onLogout?: () => void;
}

export function DesktopNostrLogin({ onLogin, onLogout }: DesktopNostrLoginProps) {
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showInput, setShowInput] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    if (isTauri()) {
      getPubkey().then(p => {
        if (p) {
          setProfile(p);
          onLogin?.(p);
        }
      });
    }
  }, [onLogin]);

  const handleLogin = async () => {
    if (!keyInput.trim()) {
      setError('Please enter a key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let result: NostrProfile;
      
      if (keyInput.startsWith('nsec1')) {
        result = await loginWithNsec(keyInput.trim());
      } else if (/^[0-9a-fA-F]{64}$/.test(keyInput.trim())) {
        result = await loginWithHex(keyInput.trim());
      } else {
        throw new Error('Invalid key format. Use nsec1... or 64-char hex.');
      }

      setProfile(result);
      setKeyInput('');
      setShowInput(false);
      onLogin?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setProfile(null);
      onLogout?.();
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  // Not in Tauri - return null or fallback to NIP-07 component
  if (!isTauri()) {
    return null;
  }

  // Logged in state
  if (profile) {
    return (
      <div className="nostr-login logged-in">
        <div className="profile-info">
          <span className="npub" title={profile.pubkey}>
            {profile.npub.slice(0, 12)}...{profile.npub.slice(-8)}
          </span>
        </div>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
    );
  }

  // Login form
  return (
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
            <button onClick={() => { setShowInput(false); setError(null); }} className="cancel-btn">
              Cancel
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="security-note">
            🔒 Your key is stored securely in memory and never leaves this device.
          </div>
        </div>
      )}
    </div>
  );
}

// CSS styles (add to your App.css or create nostr-login.css)
export const nostrLoginStyles = `
.nostr-login {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nostr-login.logged-in {
  gap: 1rem;
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
