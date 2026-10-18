// Shared date formatting utilities for MSP 2.0

/**
 * Format a date to RFC-822 format (used in RSS feeds)
 */
export function formatRFC822Date(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toUTCString();
}

/**
 * Format a stored pubDate for an <input type="datetime-local">: YYYY-MM-DDTHH:mm.
 *
 * **Local time, deliberately.** That input's value is the user's wall-clock time with no
 * offset, and fromDateTimeLocalValue reads it back as local time. The track Pub Date field
 * used to show toISOString() (UTC) while reading the input as local, so at UTC+2 the field
 * showed two hours early and every pick moved the stored date two hours back — an artist
 * who fought it until it looked right published tracks dated two hours in the future, which
 * Podcast Index hides. The two functions must round-trip exactly, or a controlled re-render
 * moves the field under the user's cursor.
 *
 * Returns '' for a date it can't read (an imported feed's pubDate is stored as raw text),
 * so rendering the field can never throw.
 */
export function toDateTimeLocalValue(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Read an <input type="datetime-local"> value back into an RFC-822 pubDate. The inverse of
 * toDateTimeLocalValue.
 *
 * Returns null when the value isn't a usable date, and the caller keeps the previous one.
 * A cleared segment makes the value '', which used to be stored as "Invalid Date" and threw
 * on the next render, blanking the whole app. A year below 1000 is one still being typed
 * (0002, 0020, 0202 on the way to 2026): RFC-822 reads a year below 100 as 20xx, so storing
 * it would jump the field to another century mid-keystroke.
 */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime()) || d.getFullYear() < 1000) return null;
  return formatRFC822Date(d);
}

/**
 * Format a Unix timestamp to a human-readable date string for display
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format a date for the `released` tag of a Nostr music event (kind 36787): MM/DD/YYYY.
 *
 * Read in UTC, deliberately. A feed's pubDate is an RFC822 UTC string, and reading it
 * with the local getters made the output depend on where the browser was:
 * "Wed, 11 Mar 2026 00:00:00 GMT" formatted as 03/10/2026 anywhere west of Greenwich,
 * so every release date MSP published from the Americas was a day early. Pairs with
 * parseReleasedDate, which builds its Date with Date.UTC for the same reason.
 */
export function formatReleasedDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${month}/${day}/${year}`;
  } catch {
    return '';
  }
}

/**
 * Parse a `released` tag back to a UTC string. The inverse of formatReleasedDate.
 *
 * **This reads MM/DD/YYYY**, matching what formatReleasedDate writes. It used to read
 * the same string as DD/MM/YYYY — the two functions disagreed in code and in their own
 * doc comments, 14 lines apart — so publishing an album to Nostr Music and importing it
 * back silently swapped the month and the day: 11 Mar 2026 came home as 3 Nov 2026.
 * Invisible for days 1-12, and for days 13+ `new Date(y, 12+, d)` rolled into the next
 * year. Every `released` tag already on a relay was written MM/DD, so reading MM/DD is
 * also what makes the existing published data parse correctly.
 *
 * Slashed dates from other tools may still be DD/MM, so an unambiguous first component
 * (>12) is read that way rather than producing an invalid date.
 */
export function parseReleasedDate(released: string): string {
  try {
    const parts = released.split('/');
    if (parts.length === 3) {
      const [a, b, year] = parts.map(p => parseInt(p, 10));
      if (!isNaN(a) && !isNaN(b) && !isNaN(year)) {
        // Ours is MM/DD; only fall back to DD/MM when the first field can't be a month.
        const [month, day] = a > 12 ? [b, a] : [a, b];
        const ms = Date.UTC(year, month - 1, day);
        if (!isNaN(ms)) return new Date(ms).toUTCString();
      }
    }
    // Fallback: anything else Date understands (ISO 8601, RFC822, …).
    const parsed = new Date(released);
    if (!isNaN(parsed.getTime())) {
      return parsed.toUTCString();
    }
    return new Date().toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}
