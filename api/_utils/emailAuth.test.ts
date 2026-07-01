import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeEmail,
  emailHash,
  signSession,
  verifySession,
  parseEmailAuthHeader
} from './emailAuth';

const HASH_KEY = 'test-email-hash-key-0000000000000000';
const SESSION_SECRET = 'test-session-secret-1111111111111111';

beforeEach(() => {
  process.env.MSP_EMAIL_HASH_KEY = HASH_KEY;
  process.env.MSP_SESSION_SECRET = SESSION_SECRET;
});

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('  Foo@Example.COM ');
    expect(normalizeEmail(once)).toBe(once);
  });

  it('applies Unicode NFC normalization', () => {
    const nfd = 'josé@example.com'; // 'e' + combining acute accent (NFD)
    const nfc = 'josé@example.com'; // precomposed 'é' (NFC)
    expect(nfd).not.toBe(nfc); // sanity: byte sequences differ pre-normalization
    expect(normalizeEmail(nfd)).toBe(nfc);
  });
});

describe('emailHash', () => {
  it('is deterministic for the same email', () => {
    expect(emailHash('a@b.com')).toBe(emailHash('a@b.com'));
  });

  it('hashes the normalized form (case/whitespace-insensitive)', () => {
    expect(emailHash('  A@B.com ')).toBe(emailHash('a@b.com'));
  });

  it('differs for different emails', () => {
    expect(emailHash('a@b.com')).not.toBe(emailHash('c@d.com'));
  });

  it('is key-sensitive (different MSP_EMAIL_HASH_KEY -> different hash)', () => {
    const withKey1 = emailHash('a@b.com');
    process.env.MSP_EMAIL_HASH_KEY = 'a-completely-different-key-2222222222';
    const withKey2 = emailHash('a@b.com');
    expect(withKey1).not.toBe(withKey2);
  });

  it('does not contain the raw email', () => {
    expect(emailHash('secret@private.com')).not.toContain('secret');
  });
});

describe('signSession / verifySession', () => {
  it('round-trips an emailHash', () => {
    const eh = emailHash('a@b.com');
    const token = signSession(eh);
    const result = verifySession(token);
    expect(result.valid).toBe(true);
    expect(result.emailHash).toBe(eh);
  });

  it('rejects a tampered token', () => {
    const token = signSession(emailHash('a@b.com'));
    const tampered = token.slice(0, -3) + (token.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
    expect(verifySession(tampered).valid).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession(emailHash('a@b.com'));
    process.env.MSP_SESSION_SECRET = 'rotated-secret-3333333333333333333333';
    expect(verifySession(token).valid).toBe(false);
  });

  it('rejects an expired token', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const token = signSession(emailHash('a@b.com'), { ttlMs: 1000 });
      vi.setSystemTime(new Date('2026-01-01T00:00:02Z')); // +2s, past 1s ttl
      expect(verifySession(token).valid).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed tokens', () => {
    expect(verifySession('not.a.jwt').valid).toBe(false);
    expect(verifySession('').valid).toBe(false);
  });
});

describe('parseEmailAuthHeader', () => {
  it('parses a valid "Bearer <jwt>" header to the emailHash', () => {
    const eh = emailHash('a@b.com');
    const token = signSession(eh);
    const result = parseEmailAuthHeader(`Bearer ${token}`);
    expect(result.valid).toBe(true);
    expect(result.emailHash).toBe(eh);
  });

  it('rejects a missing header', () => {
    expect(parseEmailAuthHeader(undefined).valid).toBe(false);
  });

  it('rejects a non-Bearer scheme', () => {
    const token = signSession(emailHash('a@b.com'));
    expect(parseEmailAuthHeader(`Nostr ${token}`).valid).toBe(false);
  });
});
