import { useState } from 'react';
import { toDateTimeLocalValue, fromDateTimeLocalValue } from '../utils/dateUtils';

/**
 * A pubDate edited as local time in an <input type="datetime-local">. `onChange` receives
 * an RFC-822 UTC string, and only ever a usable one: a cleared or half-typed field keeps
 * the last good date, which the field shows again on blur.
 *
 * While the user edits, the field shows exactly what the browser holds, even a value that
 * isn't a date yet. Typing a year digit by digit passes through 0002, 0020 and 0202; a
 * field held to the last good date would be reset on each digit and the year could never
 * be typed in.
 */
export function PubDateInput({ value, onChange }: {
  value: string;
  onChange: (pubDate: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="datetime-local"
      className="form-input"
      value={draft ?? toDateTimeLocalValue(value)}
      onChange={e => {
        setDraft(e.target.value);
        const pubDate = fromDateTimeLocalValue(e.target.value);
        if (pubDate) onChange(pubDate);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
