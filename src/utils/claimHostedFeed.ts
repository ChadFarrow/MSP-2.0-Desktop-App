// Create a hosted feed, or — when it already exists — save it as its signed-in owner.
//
// The browser's `msp2-hosted-<guid>` record is only a shortcut: it lives in one site
// address's localStorage, so a feed saved on msp.podtards.com (which now redirects)
// or on new.musicsideproject.com has no record on musicsideproject.com. Without the
// record the Save modal takes the create path, and the server answers 409. The server
// already accepts a PUT from the feed's Nostr or email owner with no edit token, so
// that is what we retry with. publisherPublish.ts does the Nostr-only version of this.
import type { HostedFeedError } from './hostedFeed';

export type HostedOwner = 'nostr' | 'email';

export const FEED_EXISTS_NOT_OWNED =
  'This feed already exists on MSP, and the account you are signed in with does not own it. ' +
  'Sign in with the Nostr identity or email linked to this feed, or use Restore with its edit token.';

export type CreateOrClaimOutcome<C, U> =
  | { kind: 'created'; result: C }
  | { kind: 'claimed'; owner: HostedOwner; result: U };

function statusOf(err: unknown): number | undefined {
  const status = (err as Partial<HostedFeedError> | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// The status is authoritative; the message is a fallback for an error raised
// somewhere that doesn't carry one.
function isAlreadyExists(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) return status === 409;
  return err instanceof Error && err.message.includes('already exists');
}

/** A 401/403: this identity doesn't own the feed. Exported for the publish step's album updates. */
export function isRefusal(err: unknown): boolean {
  const status = statusOf(err);
  return status === 401 || status === 403;
}

/**
 * Run `create`; on "already exists", try `update` as each signed-in owner in order.
 * A 401/403 from one identity moves on to the next. When every identity is refused
 * (or none is signed in) the error is FEED_EXISTS_NOT_OWNED rather than the raw 409,
 * which tells a signed-in owner to use an edit token they don't need. Any other update
 * failure — a signer timeout, a 409 for a missing ownership record — says more than
 * that, so the first one is rethrown as it is.
 */
export async function createOrClaimHostedFeed<C, U>(options: {
  create: () => Promise<C>;
  owners: HostedOwner[];
  update: (owner: HostedOwner) => Promise<U>;
}): Promise<CreateOrClaimOutcome<C, U>> {
  try {
    return { kind: 'created', result: await options.create() };
  } catch (createErr) {
    if (!isAlreadyExists(createErr)) throw createErr;
  }

  let otherFailure: unknown;
  for (const owner of options.owners) {
    try {
      return { kind: 'claimed', owner, result: await options.update(owner) };
    } catch (updateErr) {
      if (!isRefusal(updateErr) && otherFailure === undefined) otherFailure = updateErr;
    }
  }
  if (otherFailure !== undefined) throw otherFailure;
  throw new Error(FEED_EXISTS_NOT_OWNED);
}
