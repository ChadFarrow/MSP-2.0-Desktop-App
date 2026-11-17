// Where a feed asks to be listed. Two tags carry it, and they mean different
// things:
//
// - <itunes:block>Yes</itunes:block> asks the podcast directories not to list
//   the feed. Apple Podcasts honours it, and so does Podcast Index (tested: it
//   acts on itunes:block and not on podcast:block).
// - <podcast:block>yes</podcast:block> with no id asks every service that reads
//   the Podcasting 2.0 namespace not to list it. A block with an id addresses one
//   named service (serviceBlocks). The control offers no choice per service: a
//   feed that carries one shows as Custom, and picking a choice replaces them all.
//
// A musician may want to leave the podcast directories and still be found in
// music apps, so "directories" writes only itunes:block. "Everywhere" writes both,
// because each tag reaches services the other one does not.

import type { ServiceBlock } from '../types/feed';

export type Listing = 'listed' | 'directories' | 'everywhere';

export const LISTING_CHOICES: { value: Listing; label: string }[] = [
  { value: 'listed', label: 'Listed' },
  { value: 'directories', label: 'Hidden from podcast directories' },
  { value: 'everywhere', label: 'Hidden everywhere' },
];

export interface BlockFlags {
  itunesBlock?: boolean;
  podcastBlock?: boolean;
  serviceBlocks?: ServiceBlock[];
}

/**
 * The choice that the tags express, or 'custom' for what the control does not
 * offer, which only comes from an imported feed: a plain podcast:block with no
 * itunes:block, or any block that names a service. A named "no" next to a plain
 * "yes" is an exception, so "Hidden everywhere" would be wrong for it.
 */
export function listingOf(data: BlockFlags): Listing | 'custom' {
  if (data.serviceBlocks?.length) return 'custom';
  if (data.podcastBlock) return data.itunesBlock ? 'everywhere' : 'custom';
  return data.itunesBlock ? 'directories' : 'listed';
}

/** The tags for a choice. Every service block goes: the choice is the whole listing. */
export function listingFlags(listing: Listing): Required<BlockFlags> {
  return {
    itunesBlock: listing !== 'listed',
    podcastBlock: listing === 'everywhere',
    serviceBlocks: [],
  };
}

/** "spotify: yes, google: no" — what the service blocks say, for the Custom hint. */
export function describeServiceBlocks(blocks: ServiceBlock[]): string {
  return blocks.map(block => `${block.id}: ${block.value || '(empty)'}`).join(', ');
}
