import type { ValueRecipient } from '../types/feed';

/**
 * Validate that every value recipient has a usable split.
 *
 * Podcasting 2.0 splits are proportional, so a recipient left at 0 (or empty → NaN)
 * receives nothing and the remaining splits absorb all the sats — a silent way for an
 * artist's share to end up going entirely to the community-support recipients. This
 * returns a human-readable error for each offending recipient so the Save flow can block
 * submitting an incomplete feed to Podcast Index.
 *
 * @param recipients the value block's recipients (undefined/empty → no errors)
 * @param label prefix for the message, e.g. "Value recipient" or "Track 2 value recipient"
 */
export function getValueRecipientErrors(
  recipients: ValueRecipient[] | undefined,
  label: string
): string[] {
  if (!recipients || recipients.length === 0) return [];

  const errors: string[] = [];
  recipients.forEach((recipient, index) => {
    if (!Number.isFinite(recipient.split) || recipient.split <= 0) {
      const who = recipient.name?.trim() || recipient.address?.trim() || `#${index + 1}`;
      errors.push(`${label} "${who}" needs a split %`);
    }
  });
  return errors;
}
