// Email magic-link authentication helpers (non-Nostr ownership path for hosted feeds).
//
// Security model: the raw email is NEVER persisted server-side. Ownership and sessions
// reference only `emailHash` — a keyed HMAC of the normalized address — so nothing
// reversible to a real email ever lands in a (public) Vercel Blob. Sessions are
// stateless signed JWTs (HS256), mirroring the stateless-Nostr choice in adminAuth.ts.
import { createHmac, timingSafeEqual } from 'crypto';

export interface EmailAuthResult {
  valid: boolean;
  emailHash?: string;
  error?: string;
}

// Default session lifetime: 30 days.
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalize an email for hashing/comparison: trim, lowercase, Unicode NFC.
 * Deterministic and idempotent so the same human address always maps to one hash.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().normalize('NFC');
}

function getHashKey(): string {
  const key = process.env.MSP_EMAIL_HASH_KEY;
  if (!key) {
    throw new Error('MSP_EMAIL_HASH_KEY not configured');
  }
  return key;
}

function getSessionSecret(): string {
  const secret = process.env.MSP_SESSION_SECRET;
  if (!secret) {
    throw new Error('MSP_SESSION_SECRET not configured');
  }
  return secret;
}

/**
 * Opaque, keyed HMAC-SHA256 of the normalized email (hex). Stored in feed metadata
 * as `ownerEmailHash` and used as the account index key. Not reversible without the key.
 */
export function emailHash(email: string): string {
  return createHmac('sha256', getHashKey())
    .update(normalizeEmail(email))
    .digest('hex');
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Mint a stateless HS256 session JWT carrying the emailHash as `sub`.
 * Verified server-side on hosted writes via the `X-Email-Session` header.
 */
export function signSession(emailHashHex: string, opts: { ttlMs?: number } = {}): string {
  const now = Date.now();
  const ttlMs = opts.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const headerB64 = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = b64urlJson({
    sub: emailHashHex,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + ttlMs) / 1000)
  });
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = createHmac('sha256', getSessionSecret()).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * Verify a session JWT: constant-time signature check, then expiry. Returns the emailHash on success.
 */
export function verifySession(token: string): EmailAuthResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token' };
  }
  const [headerB64, payloadB64, sig] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', getSessionSecret()).update(signingInput).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid signature' };
  }

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }

  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) {
    return { valid: false, error: 'Token expired' };
  }
  if (!payload.sub) {
    return { valid: false, error: 'Missing subject' };
  }
  return { valid: true, emailHash: payload.sub };
}

/**
 * Parse an `Authorization: Bearer <jwt>` / `X-Email-Session: Bearer <jwt>` header.
 */
export function parseEmailAuthHeader(header: string | undefined): EmailAuthResult {
  if (!header || !header.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid auth header' };
  }
  return verifySession(header.slice(7));
}
