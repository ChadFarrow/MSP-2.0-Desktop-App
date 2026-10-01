import type { RemoteItem } from '../types/feed';

// What a publisher is to its catalog: the artist, or a label. It is written as
// `rel` on both sides of each publisher link — on the publisher feed's
// <podcast:remoteItem> for the album, and on the remoteItem inside the album's
// <podcast:publisher>. Both sides carry the same value, so an index sees them
// agree.
//
// `rel` on <podcast:remoteItem> is not in the spec yet. It is proposed in
// podcast-namespace discussion #579. Conforming parsers ignore an attribute they
// don't know, so writing it costs other readers nothing (the same reasoning that
// keeps `feedImg`).
//
// An absent rel means "not stated". MSP never writes a default role, so an index
// does not show a guess as a fact.
export const PUBLISHER_ROLES = [
  { value: '', label: 'Not stated' },
  { value: 'artist', label: 'Artist' },
  { value: 'label', label: 'Label' },
] as const;

/**
 * The role every catalog item states: '' when none states one (or the catalog
 * is empty), or null when the items differ — which only happens for an imported
 * feed that wrote different values per item.
 */
export function catalogRole(items: RemoteItem[]): string | null {
  const roles = new Set(items.map(item => item.rel || ''));
  if (roles.size === 0) return '';
  if (roles.size === 1) return [...roles][0];
  return null;
}

/** The item with `rel` set to the role, or with no `rel` when the role is ''. */
export function withRole(item: RemoteItem, role: string): RemoteItem {
  const next: RemoteItem = { ...item };
  if (role) {
    next.rel = role;
  } else {
    delete next.rel;
  }
  return next;
}
