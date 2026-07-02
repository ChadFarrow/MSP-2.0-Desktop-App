import { useEffect, useMemo, useRef, useState } from 'react';
import { verifyMagicLink } from '../utils/emailSession';

type Status = 'verifying' | 'success' | 'error';

/**
 * Full-page handler for the emailed magic link (/auth/verify?token=...).
 * Redeems the token, stores the session, then sends the user into the app.
 */
export function VerifyMagicLink() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), []);
  // Derive the no-token error state up-front so the effect never sets state synchronously.
  const [status, setStatus] = useState<Status>(token ? 'verifying' : 'error');
  const [error, setError] = useState<string | null>(token ? null : 'This link is missing its token.');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // guard against StrictMode double-invoke (token is single-use)
    ran.current = true;

    verifyMagicLink(token)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Invalid or expired link');
      });
  }, [token]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '420px',
        textAlign: 'center',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '32px'
      }}>
        {status === 'verifying' && (
          <>
            <h2 style={{ marginTop: 0 }}>Signing you in…</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Verifying your link.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h2 style={{ marginTop: 0 }}>You're signed in ✅</h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Your email is now linked. You can manage your hosted feeds from any device.
            </p>
            <a href="/" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '12px', textDecoration: 'none' }}>
              Continue to MSP
            </a>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 style={{ marginTop: 0 }}>Link problem</h2>
            <p style={{ color: 'var(--error, #ef4444)' }}>{error}</p>
            <a href="/" className="btn btn-secondary" style={{ display: 'inline-block', marginTop: '12px', textDecoration: 'none' }}>
              Back to MSP
            </a>
          </>
        )}
      </div>
    </div>
  );
}
