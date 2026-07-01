import { describe, it, expect } from 'vitest';
import { createEmptyAlbum, createEmptyVideoAlbum, createEmptyTrack, PODCAST_IMAGE_PURPOSES, fillPersonalSplitDefault, rebalancePersonalForSupport, createSupportRecipients } from './feed';
import type { ValueRecipient } from './feed';

const support = createSupportRecipients(); // MSP 1 + Podcast Index 1
const personal = (over: Partial<ValueRecipient> = {}): ValueRecipient =>
  ({ name: 'Artist', address: 'artist@getalby.com', split: 0, type: 'lnaddress', ...over });

describe('fillPersonalSplitDefault (Behavior 1: lnaddress → 98)', () => {
  it('sets a blank personal lnaddress split to 100 minus support (98)', () => {
    const recipients = [personal({ split: 0 }), ...support];
    const result = fillPersonalSplitDefault(recipients, 0);
    expect(result[0].split).toBe(98);
    expect(result.slice(1)).toEqual(support); // support untouched
  });

  it('does not overwrite a split the user already set', () => {
    const recipients = [personal({ split: 50 }), ...support];
    expect(fillPersonalSplitDefault(recipients, 0)[0].split).toBe(50);
  });

  it('leaves node-pubkey recipients alone (Lightning addresses only)', () => {
    const node = personal({ address: 'a'.repeat(66), type: 'node', split: 0 });
    const recipients = [node, ...support];
    expect(fillPersonalSplitDefault(recipients, 0)[0].split).toBe(0);
  });

  it('does nothing when the edited row is a support recipient', () => {
    const recipients = [personal({ split: 98 }), ...support];
    expect(fillPersonalSplitDefault(recipients, 1)).toEqual(recipients);
  });

  it('does not fill when there is more than one personal recipient', () => {
    const recipients = [personal({ split: 60 }), personal({ address: 'band@getalby.com', split: 0 }), ...support];
    expect(fillPersonalSplitDefault(recipients, 1)).toEqual(recipients);
  });

  it('clamps to 0 when support already exceeds 100', () => {
    const heavy: ValueRecipient[] = [{ name: 'MSP 2.0', address: 'chadf@getalby.com', split: 120, type: 'lnaddress' }];
    const recipients = [personal({ split: 0 }), ...heavy];
    expect(fillPersonalSplitDefault(recipients, 0)[0].split).toBe(0);
  });
});

describe('rebalancePersonalForSupport (Behavior 2: keep total at 100)', () => {
  it('shrinks the personal split when a support split is raised', () => {
    const recipients = [personal({ split: 98 }), { ...support[0], split: 3 }, support[1]];
    expect(rebalancePersonalForSupport(recipients)[0].split).toBe(96); // 100 - 3 - 1
  });

  it('grows the personal split back toward 100 as support shrinks', () => {
    const recipients = [personal({ split: 98 }), support[1]]; // only Podcast Index (1) remains
    expect(rebalancePersonalForSupport(recipients)[0].split).toBe(99);
  });

  it('gives the personal recipient 100 when all support is removed', () => {
    const recipients = [personal({ split: 98 })];
    expect(rebalancePersonalForSupport(recipients)[0].split).toBe(100);
  });

  it('leaves splits alone when there is more than one personal recipient', () => {
    const recipients = [personal({ split: 60 }), personal({ address: 'band@getalby.com', split: 38 }), ...support];
    expect(rebalancePersonalForSupport(recipients)).toEqual(recipients);
  });

  it('clamps the personal split to 0 when support exceeds 100', () => {
    const recipients = [personal({ split: 98 }), { ...support[0], split: 101 }, support[1]];
    expect(rebalancePersonalForSupport(recipients)[0].split).toBe(0);
  });
});

describe('podcastImages data model', () => {
  it('initializes podcastImages to an empty array on album, video album, and track', () => {
    expect(createEmptyAlbum().podcastImages).toEqual([]);
    expect(createEmptyVideoAlbum().podcastImages).toEqual([]);
    expect(createEmptyTrack(1).podcastImages).toEqual([]);
  });

  it('exposes the canvas purpose preset for Now Playing backgrounds', () => {
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('canvas');
    expect(PODCAST_IMAGE_PURPOSES.map(p => p.value)).toContain('artwork');
  });
});
