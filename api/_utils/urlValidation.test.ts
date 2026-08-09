import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getFeedUrlError, normalizeFeedUrl } from './urlValidation';

// Built at runtime so the escape sequences live in one obvious place.
const NBSP = String.fromCharCode(0x00a0);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);

describe('normalizeFeedUrl', () => {
  const CLEAN = 'https://example.com/feed.xml';

  it('strips leading, trailing and both-ends spaces', () => {
    expect(normalizeFeedUrl(` ${CLEAN}`)).toBe(CLEAN);
    expect(normalizeFeedUrl(`${CLEAN} `)).toBe(CLEAN);
    expect(normalizeFeedUrl(`   ${CLEAN}   `)).toBe(CLEAN);
  });

  it('strips tabs, newlines and CRLF at both ends', () => {
    expect(normalizeFeedUrl(`\t${CLEAN}\t`)).toBe(CLEAN);
    expect(normalizeFeedUrl(`\n${CLEAN}\n`)).toBe(CLEAN);
    expect(normalizeFeedUrl(`\r\n${CLEAN}\r\n`)).toBe(CLEAN);
  });

  it('strips NBSP, zero-width space and BOM at both ends', () => {
    expect(normalizeFeedUrl(`${NBSP}${CLEAN}${NBSP}`)).toBe(CLEAN);
    expect(normalizeFeedUrl(`${ZERO_WIDTH_SPACE}${CLEAN}`)).toBe(CLEAN);
    expect(normalizeFeedUrl(`${BOM}${CLEAN}`)).toBe(CLEAN);
  });

  it('strips a mix of junk in one go', () => {
    expect(normalizeFeedUrl(`${BOM} \t${CLEAN}${NBSP}\n `)).toBe(CLEAN);
  });

  it('preserves interior whitespace — trimming must not invent a different URL', () => {
    expect(normalizeFeedUrl(' https://example.com/my feed.xml ')).toBe(
      'https://example.com/my feed.xml'
    );
  });

  it('is idempotent', () => {
    const inputs = [
      ` ${CLEAN} `,
      `\n${CLEAN}`,
      `${BOM}${CLEAN}${NBSP}`,
      'https://example.com/my feed.xml',
      CLEAN,
      '',
    ];
    for (const input of inputs) {
      expect(normalizeFeedUrl(normalizeFeedUrl(input))).toBe(normalizeFeedUrl(input));
    }
  });

  it('collapses whitespace-only and empty input to an empty string', () => {
    expect(normalizeFeedUrl('   ')).toBe('');
    expect(normalizeFeedUrl(`\t\n${NBSP}`)).toBe('');
    expect(normalizeFeedUrl('')).toBe('');
  });

  it('leaves an already-clean URL untouched', () => {
    expect(normalizeFeedUrl(CLEAN)).toBe(CLEAN);
  });
});

describe('getFeedUrlError', () => {
  it('returns null for clean URLs', () => {
    expect(getFeedUrlError('https://example.com/feed.xml')).toBeNull();
    expect(getFeedUrlError('https://msp.podtards.com/api/hosted/abc-123.xml')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getFeedUrlError('')).toBeNull();
  });

  // The regression this whole change exists for: a pasted URL carrying edge
  // whitespace used to be rejected as "URL contains spaces" even though the user
  // could see nothing wrong with it.
  it('returns null for a pasted URL with leading and trailing spaces', () => {
    expect(getFeedUrlError(' https://example.com/feed.xml ')).toBeNull();
  });

  it('returns null for other edge whitespace a paste can carry', () => {
    expect(getFeedUrlError('\nhttps://example.com/feed.xml')).toBeNull();
    expect(getFeedUrlError('\thttps://example.com/feed.xml')).toBeNull();
    expect(getFeedUrlError(`${NBSP}https://example.com/feed.xml`)).toBeNull();
    expect(getFeedUrlError(`${BOM}https://example.com/feed.xml `)).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(getFeedUrlError('   ')).toBeNull();
  });

  it('flags an interior space', () => {
    const err = getFeedUrlError('https://example.com/my feed.xml');
    expect(err).toMatch(/spaces/);
  });

  it('tells the user to rename the file at the host, not edit the box', () => {
    const err = getFeedUrlError('https://example.com/my feed.xml');
    expect(err).toMatch(/Rename the file at your host/);
  });

  // new URL() deletes interior tabs and newlines, so before this check Podcast
  // Index was handed a URL the user never typed.
  it('flags an interior tab', () => {
    expect(getFeedUrlError('https://example.com/my\tfeed.xml')).toMatch(/spaces/);
  });

  it('flags an interior newline', () => {
    expect(getFeedUrlError('https://example.com/my\nfeed.xml')).toMatch(/spaces/);
  });

  it('flags an interior NBSP as both whitespace and non-ASCII', () => {
    const err = getFeedUrlError(`https://example.com/my${NBSP}feed.xml`);
    expect(err).toMatch(/spaces/);
    expect(err).toMatch(/non-ASCII/);
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

// This module is duplicated because Vercel functions cannot import from src/.
// The duplication is deliberate; silent drift between the two copies is not —
// and drift is exactly the bug class this file's feature was fixing.
describe('src/api mirror', () => {
  it('stays identical to src/utils/urlValidation.ts apart from the header comment', () => {
    const api = readFileSync(new URL('./urlValidation.ts', import.meta.url), 'utf8');
    const src = readFileSync(
      new URL('../../src/utils/urlValidation.ts', import.meta.url),
      'utf8'
    );
    // The api copy is the src file prefixed with a 2-line header plus a blank
    // line. Drop exactly those three and the rest must match byte for byte.
    const header = api.split('\n').slice(0, 3);
    expect(header[0]).toMatch(/^\/\/ Mirror of src\/utils\/urlValidation\.ts/);
    expect(header[2]).toBe('');
    expect(api.split('\n').slice(3).join('\n')).toBe(src);
  });
});
