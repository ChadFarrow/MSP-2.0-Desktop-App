import { describe, it, expect } from 'vitest';
import { generateLinkToken, linkBlobPath, indexBlobPath } from './accountStore';
import { hashToken } from './feedUtils';

describe('generateLinkToken', () => {
  it('produces a URL-safe token of meaningful length', () => {
    const token = generateLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(token.length).toBeGreaterThanOrEqual(40); // 32 bytes -> ~43 chars
  });

  it('produces a unique token each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateLinkToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('blob path helpers', () => {
  it('derives the link blob path from the token hash (never the raw token)', () => {
    const token = generateLinkToken();
    const path = linkBlobPath(token);
    expect(path).toBe(`accounts/links/${hashToken(token)}.json`);
    expect(path).not.toContain(token); // raw token never appears in the path
  });

  it('derives the account index path from the emailHash', () => {
    expect(indexBlobPath('deadbeef')).toBe('accounts/index/deadbeef.json');
  });
});
