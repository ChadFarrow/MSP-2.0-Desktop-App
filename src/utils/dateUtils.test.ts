import { describe, it, expect } from 'vitest';
import { formatReleasedDate, parseReleasedDate, toDateTimeLocalValue, fromDateTimeLocalValue } from './dateUtils';

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

/**
 * The track Pub Date field is an <input type="datetime-local">, whose value is local
 * wall-clock time with no offset. It used to show the UTC time (toISOString) while reading
 * the input back as local time, so at UTC+2 each pick moved the stored date two hours back,
 * and a cleared segment stored "Invalid Date", whose next render threw and blanked the app.
 * Expectations are built with the local Date constructor, so these pass in any timezone.
 */
describe('toDateTimeLocalValue', () => {
  it('shows the local time the user picked, not the UTC time', () => {
    const picked = new Date(2026, 9, 18, 22, 44).toUTCString();
    expect(toDateTimeLocalValue(picked)).toBe('2026-10-18T22:44');
  });

  it('does not roll the day, month or year at midnight', () => {
    expect(toDateTimeLocalValue(new Date(2026, 9, 19, 0, 30).toUTCString())).toBe('2026-10-19T00:30');
    expect(toDateTimeLocalValue(new Date(2026, 11, 31, 23, 59).toUTCString())).toBe('2026-12-31T23:59');
    expect(toDateTimeLocalValue(new Date(2027, 0, 1, 0, 0).toUTCString())).toBe('2027-01-01T00:00');
  });

  it('returns empty for a date it cannot read, so the field can always render', () => {
    expect(toDateTimeLocalValue('Invalid Date')).toBe('');
    expect(toDateTimeLocalValue('not a date')).toBe('');
    expect(toDateTimeLocalValue('')).toBe('');
  });
});

describe('fromDateTimeLocalValue', () => {
  it('reads the value as local time and stores it as RFC822 UTC', () => {
    expect(fromDateTimeLocalValue('2026-10-18T22:44')).toBe(new Date(2026, 9, 18, 22, 44).toUTCString());
  });

  it('returns null for an empty or half-typed value instead of an invalid date', () => {
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('garbage')).toBeNull();
    // A year typed digit by digit passes through 0002, 0020 and 0202. RFC822 reads a
    // year below 100 as 20xx, so storing one would jump the field to another century.
    expect(fromDateTimeLocalValue('0002-10-18T22:44')).toBeNull();
    expect(fromDateTimeLocalValue('0202-10-18T22:44')).toBeNull();
  });
});

describe('datetime-local round trip', () => {
  it('gives back what the field showed, so re-rendering never moves it', () => {
    for (const value of ['2026-10-18T22:44', '2026-10-19T00:30', '2026-03-29T03:15', '2027-01-01T00:00']) {
      const stored = fromDateTimeLocalValue(value);
      expect(stored, value).not.toBeNull();
      expect(toDateTimeLocalValue(stored!), value).toBe(value);
    }
  });

  it('does not drift over repeated edits', () => {
    let stored = new Date(2026, 9, 18, 22, 44).toUTCString();
    for (let i = 0; i < 5; i++) {
      stored = fromDateTimeLocalValue(toDateTimeLocalValue(stored))!;
    }
    expect(stored).toBe(new Date(2026, 9, 18, 22, 44).toUTCString());
  });
});
