import { describe, it, expect } from 'vitest';
import { getFeedUrlError } from './urlValidation';

describe('getFeedUrlError', () => {
  it('returns null for clean URLs', () => {
    expect(getFeedUrlError('https://example.com/feed.xml')).toBeNull();
    expect(getFeedUrlError('https://msp.podtards.com/api/hosted/abc-123.xml')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getFeedUrlError('')).toBeNull();
  });

  it('flags spaces', () => {
    const err = getFeedUrlError('https://example.com/my feed.xml');
    expect(err).toMatch(/spaces/);
  });

  it("flags apostrophes (Podcast Index encodes ' as %27 → duplicate feeds)", () => {
    const err = getFeedUrlError("https://example.com/o'malley.xml");
    expect(err).toMatch(/apostrophes/);
    expect(err).toMatch(/%27/);
  });

  it('flags special characters that require percent-encoding', () => {
    expect(getFeedUrlError('https://example.com/<feed>.xml')).toMatch(/special characters/);
    expect(getFeedUrlError('https://example.com/feed|x.xml')).toMatch(/special characters/);
  });

  it('flags non-ASCII characters', () => {
    const err = getFeedUrlError('https://example.com/feèd.xml');
    expect(err).toMatch(/non-ASCII/);
  });

  it('lists every offending category in one message', () => {
    const err = getFeedUrlError("https://example.com/o'malley feèd.xml");
    expect(err).toMatch(/spaces/);
    expect(err).toMatch(/apostrophes/);
    expect(err).toMatch(/non-ASCII/);
  });
});
