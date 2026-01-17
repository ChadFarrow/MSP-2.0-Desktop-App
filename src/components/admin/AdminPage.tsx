import { useState, useEffect } from 'react';
import { useNostr } from '../../store/nostrStore';
import { FeedList } from './FeedList';
import mspLogo from '../../assets/msp-logo.png';

type AuthState = 'checking' | 'no-extension' | 'not-logged-in' | 'ready';

export function AdminPage() {
  const { state: nostrState, login } = useNostr();
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nostrState.hasExtension) {
      setAuthState('no-extension');
    } else if (!nostrState.isLoggedIn) {
      setAuthState('not-logged-in');
    } else {
      setAuthState('ready');
    }
  }, [nostrState.hasExtension, nostrState.isLoggedIn]);

  const handleLogin = async () => {
    await login();
  };

  return (
    <div className="admin-page">
      <header className="header">
        <div className="header-title">
          <img src={mspLogo} alt="MSP Logo" className="header-logo" />
          <h1>MSP 2.0 - Admin</h1>
        </div>
        <div className="header-actions">
          <a href="/" className="btn btn-secondary btn-small">
            Back to Editor
          </a>
        </div>
      </header>

      <main className="admin-main">
        {authState === 'checking' && (
          <div className="admin-status">Checking extension...</div>
        )}

        {authState === 'no-extension' && (
          <div className="admin-status">
            <h2>Nostr Extension Required</h2>
            <p>Please install a NIP-07 compatible browser extension (like Alby or nos2x) to use the admin panel.</p>
          </div>
        )}

        {authState === 'not-logged-in' && (
          <div className="admin-status">
            <h2>Login Required</h2>
            <p>Please sign in with your Nostr extension to continue.</p>
            <button className="btn btn-primary" onClick={handleLogin}>
              Sign In with Nostr
            </button>
          </div>
        )}

        {authState === 'ready' && (
          <div className="admin-content">
            <div className="admin-info">
              Signed in as: <code>{nostrState.user?.pubkey.slice(0, 8)}...{nostrState.user?.pubkey.slice(-8)}</code>
            </div>
            <FeedList onError={setError} currentUserPubkey={nostrState.user?.pubkey} />
            {error && <div className="admin-error">{error}</div>}
          </div>
        )}
      </main>

      <style>{`
        .admin-page {
          min-height: 100vh;
          background: var(--bg-primary);
        }
        .admin-main {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }
        .admin-status {
          text-align: center;
          padding: 3rem;
          background: var(--bg-secondary);
          border-radius: 8px;
          margin-top: 2rem;
        }
        .admin-status h2 {
          margin-bottom: 1rem;
        }
        .admin-status p {
          margin-bottom: 1.5rem;
          color: var(--text-secondary);
        }
        .admin-content {
          margin-top: 2rem;
        }
        .admin-info {
          background: var(--bg-secondary);
          padding: 1rem;
          border-radius: 8px;
          margin-bottom: 1.5rem;
        }
        .admin-info code {
          background: var(--bg-tertiary);
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
        }
        .admin-error {
          color: #dc3545;
          margin-top: 1rem;
          padding: 1rem;
          background: rgba(220, 53, 69, 0.1);
          border-radius: 4px;
        }
        .admin-loading {
          text-align: center;
          padding: 2rem;
          color: var(--text-secondary);
        }
        .admin-loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 1.5rem;
          z-index: 1000;
        }
        .admin-feed-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        .admin-feed-header h3 {
          margin: 0;
        }
        .admin-feed-list {
          background: var(--bg-secondary);
          border-radius: 8px;
          padding: 1.5rem;
        }
        .admin-table {
          width: 100%;
          border-collapse: collapse;
        }
        .admin-table th,
        .admin-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid var(--border-color);
        }
        .admin-table th {
          background: var(--bg-tertiary);
          font-weight: 600;
        }
        .admin-table td.feed-id {
          font-family: monospace;
          font-size: 0.85em;
        }
        .admin-table tr:hover {
          background: var(--bg-tertiary);
        }
        .other-feeds-section {
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--border-color);
        }
        .other-feeds-header h3 {
          color: #e5a00d;
        }
        .warning-icon {
          color: #e5a00d;
          font-size: 1.1em;
        }
        .btn-delete-other {
          background-color: #6c757d;
          color: white;
          border: none;
        }
        .btn-delete-other:hover {
          background-color: #dc3545;
        }
      `}</style>
    </div>
  );
}
