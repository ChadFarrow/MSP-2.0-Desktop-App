import { describe, it, expect } from 'vitest';
import { formatReleasedDate, parseReleasedDate } from './dateUtils';

/**
 * These two functions are the two ends of one wire: formatReleasedDate writes the
 * `released` tag of a kind-36787 Nostr music event (nostrSync.ts:556), and
 * parseReleasedDate reads it back into track.pubDate (nostrMusicConverter.ts:157).
 * They disagreed on both the field order and the timezone, and nothing tested them.
 */
describe('formatReleasedDate', () => {
  it('reads the date in UTC, not the browser\'s timezone', () => {
    // A feed pubDate is an RFC822 UTC string. With local getters this produced
    // 03/10/2026 anywhere west of Greenwich — every release date published from the
    // Americas was a day early — while being correct in Tokyo. The assertion is
    // timezone-independent now, which is also what keeps this test honest in CI.
    expect(formatReleasedDate('Wed, 11 Mar 2026 00:00:00 GMT')).toBe('03/11/2026');
  });

  it('does not roll over at either end of the day', () => {
    expect(formatReleasedDate('Wed, 11 Mar 2026 23:59:59 GMT')).toBe('03/11/2026');
    expect(formatReleasedDate('Thu, 01 Jan 2026 00:00:00 GMT')).toBe('01/01/2026');
    expect(formatReleasedDate('Thu, 31 Dec 2026 23:00:00 GMT')).toBe('12/31/2026');
  });

  it('returns empty for an unparseable input', () => {
    expect(formatReleasedDate('not a date')).toBe('');
    expect(formatReleasedDate('')).toBe('');
  });
});

describe('parseReleasedDate', () => {
  it('reads MM/DD/YYYY — the format formatReleasedDate writes', () => {
    // The bug: this was read as DD/MM, turning 11 March into 3 November.
    const utc = parseReleasedDate('03/11/2026');
    const d = new Date(utc);
    expect(d.getUTCMonth()).toBe(2); // March
    expect(d.getUTCDate()).toBe(11);
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it('falls back to DD/MM when the first field cannot be a month', () => {
    // Not our format, but other tools emit it and >12 is unambiguous.
    const d = new Date(parseReleasedDate('25/12/2026'));
    expect(d.getUTCMonth()).toBe(11); // December
    expect(d.getUTCDate()).toBe(25);
  });

  it('still understands ISO 8601', () => {
    const d = new Date(parseReleasedDate('2026-03-11'));
    expect(d.getUTCMonth()).toBe(2);
    expect(d.getUTCDate()).toBe(11);
  });
});

describe('round trip', () => {
  // Every day of a month, so a regression on either side shows up regardless of
  // whether the day happens to be <= 12 (where a swap is silent) or > 12 (where the
  // old code rolled into the following year).
  it('survives publish -> import for every day of March 2026', () => {
    for (let day = 1; day <= 31; day++) {
      const original = new Date(Date.UTC(2026, 2, day)).toUTCString();
      const back = parseReleasedDate(formatReleasedDate(original));
      expect(back, `day ${day}`).toBe(original);
    }
  });

  it('survives the ambiguous first-twelve days, where a swap would be silent', () => {
    for (let month = 0; month < 12; month++) {
      const original = new Date(Date.UTC(2026, month, 5)).toUTCString();
      expect(parseReleasedDate(formatReleasedDate(original)), `month ${month + 1}`).toBe(original);
    }
  });
});
