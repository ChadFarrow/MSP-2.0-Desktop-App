import type { CSSProperties, ReactNode } from 'react';

interface SignInPromptProps {
  title: string;
  blurb: string;
  onEmail: () => void;
  onNostr: () => void;
  /** Margin/layout overrides for the panel container */
  style?: CSSProperties;
  /** Extra content rendered below the sign-in buttons (e.g. a restore link) */
  children?: ReactNode;
}

/**
 * Purple "Sign in with email / Sign in with Nostr" CTA panel shared by the
 * Save and Import modals. Callers own the modals the buttons open — pass
 * handlers that show EmailLoginModal / NostrConnectModal.
 */
export function SignInPrompt({ title, blurb, onEmail, onNostr, style, children }: SignInPromptProps) {
  return (
    <div style={{ padding: '16px', backgroundColor: 'rgba(124, 58, 237, 0.08)', borderRadius: '8px', border: '1px solid var(--border-color)', ...style }}>
      <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 0, marginBottom: '4px' }}>
        {title}
      </p>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        {blurb}
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }} onClick={onEmail}>
          Sign in with email
        </button>
        <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }} onClick={onNostr}>
          Sign in with Nostr
        </button>
      </div>
      {children}
    </div>
  );
}
