import { describe, it, expect, vi } from 'vitest';
import { createOrClaimHostedFeed, FEED_EXISTS_NOT_OWNED, type HostedOwner } from './claimHostedFeed';
import { HostedFeedError } from './hostedFeed';

const EXISTS = 'Feed already exists for this podcast. Use your edit token to update it, or use the Restore flow.';

const created = { feedId: 'guid', editToken: 'tok', url: 'u', blobUrl: 'b' };
const updated = { success: true, podcastIndexId: 42 };

function exists() {
  return new HostedFeedError(EXISTS, 409);
}

describe('createOrClaimHostedFeed', () => {
  it('returns the created feed and never updates when the create succeeds', async () => {
    const update = vi.fn();
    const outcome = await createOrClaimHostedFeed({
      create: async () => created,
      owners: ['nostr', 'email'],
      update
    });
    expect(outcome).toEqual({ kind: 'created', result: created });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates as the Nostr owner when the feed already exists', async () => {
    const update = vi.fn<(owner: HostedOwner) => Promise<typeof updated>>(async () => updated);
    const outcome = await createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: ['nostr'],
      update
    });
    expect(outcome).toEqual({ kind: 'claimed', owner: 'nostr', result: updated });
    expect(update.mock.calls).toEqual([['nostr']]);
  });

  it('updates as the email owner when only email is signed in', async () => {
    const update = vi.fn<(owner: HostedOwner) => Promise<typeof updated>>(async () => updated);
    const outcome = await createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: ['email'],
      update
    });
    expect(outcome).toEqual({ kind: 'claimed', owner: 'email', result: updated });
    expect(update.mock.calls).toEqual([['email']]);
  });

  it('tries email when the Nostr identity does not own the feed', async () => {
    const update = vi.fn(async (owner: HostedOwner) => {
      if (owner === 'nostr') throw new HostedFeedError('Invalid credentials', 403);
      return updated;
    });
    const outcome = await createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: ['nostr', 'email'],
      update
    });
    expect(outcome).toEqual({ kind: 'claimed', owner: 'email', result: updated });
    expect(update.mock.calls).toEqual([['nostr'], ['email']]);
  });

  it('explains the conflict instead of the raw 409 when nobody is signed in', async () => {
    const update = vi.fn();
    const result = createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: [],
      update
    });
    await expect(result).rejects.toThrow(FEED_EXISTS_NOT_OWNED);
    expect(FEED_EXISTS_NOT_OWNED).not.toBe(EXISTS);
    expect(update).not.toHaveBeenCalled();
  });

  it('explains the conflict when every signed-in identity is refused', async () => {
    const result = createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: ['nostr', 'email'],
      update: async () => { throw new HostedFeedError('Invalid credentials', 403); }
    });
    await expect(result).rejects.toThrow(FEED_EXISTS_NOT_OWNED);
  });

  it('reports a failure that is not a refusal, such as a signer timeout', async () => {
    const timeout = new Error('Signer did not respond. Open your signer app and approve the request.');
    const result = createOrClaimHostedFeed({
      create: async () => { throw exists(); },
      owners: ['nostr'],
      update: async () => { throw timeout; }
    });
    await expect(result).rejects.toBe(timeout);
  });

  it('rethrows any other create failure unchanged', async () => {
    const tooLarge = new HostedFeedError('XML content too large (max 1MB)', 400);
    const update = vi.fn();
    const result = createOrClaimHostedFeed({
      create: async () => { throw tooLarge; },
      owners: ['nostr'],
      update
    });
    await expect(result).rejects.toBe(tooLarge);
    expect(update).not.toHaveBeenCalled();
  });

  it('recognises the conflict by its message when the error carries no status', async () => {
    const update = vi.fn<(owner: HostedOwner) => Promise<typeof updated>>(async () => updated);
    const outcome = await createOrClaimHostedFeed({
      create: async () => { throw new Error(EXISTS); },
      owners: ['nostr'],
      update
    });
    expect(outcome).toEqual({ kind: 'claimed', owner: 'nostr', result: updated });
  });
});
