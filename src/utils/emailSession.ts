// Frontend client for email magic-link auth (the non-Nostr feed-ownership path).
import { emailSessionStorage, type EmailSessionInfo } from './storage';

/** Current stored session, or null. */
export function getEmailSession(): EmailSessionInfo | null {
  return emailSessionStorage.load();
}

export function isEmailLoggedIn(): boolean {
  return Boolean(emailSessionStorage.load()?.session);
}

export function setEmailSession(info: EmailSessionInfo): void {
  emailSessionStorage.save(info);
}

export function clearEmailSession(): void {
  emailSessionStorage.clear();
}

/** Merge the X-Email-Session header into a headers object when logged in. */
export function withEmailAuth(headers: Record<string, string> = {}): Record<string, string> {
  const session = emailSessionStorage.load()?.session;
  return session ? { ...headers, 'X-Email-Session': `Bearer ${session}` } : headers;
}

/**
 * Request a magic link. Always resolves on a 200 (enumeration-safe); throws only on
 * transport/validation errors so the UI can show "check your inbox" without leaking
 * whether the address exists.
 */
export async function requestMagicLink(
  email: string,
  opts: { purpose?: 'login' | 'claim'; feedId?: string; editToken?: string } = {}
): Promise<void> {
  const response = await fetch('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, ...opts })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Failed to send link' }));
    throw new Error(err.error || 'Failed to send link');
  }
}

/**
 * Redeem a magic-link token. On success, persists the session and returns it.
 */
export async function verifyMagicLink(token: string): Promise<EmailSessionInfo> {
  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Invalid or expired link' }));
    throw new Error(err.error || 'Invalid or expired link');
  }
  const data = await response.json() as { session: string; emailHash: string };
  const info: EmailSessionInfo = {
    session: data.session,
    emailHash: data.emailHash,
    createdAt: Date.now()
  };
  emailSessionStorage.save(info);
  return info;
}
