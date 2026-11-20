import type { RemoteItem } from '../types/feed';

// What a publisher is to its catalog: the artist, or a label. It is written as
// `rel` on both sides of each publisher link — on the publisher feed's
// <podcast:remoteItem> for the album, and on the remoteItem inside the album's
// <podcast:publisher>. Both sides carry the same value, so an index sees them
// agree.
//
// `rel` on <podcast:remoteItem> is not in the spec yet. It was proposed in
// podcast-namespace discussion #579, and PR #793 makes it a space-separated set
// of role tokens, so one party with two roles keeps one remoteItem
// (rel="artist producer"). Conforming parsers ignore an attribute they don't
// know, so writing it costs other readers nothing (the same reasoning that
// keeps `feedImg`). The controls that set it are beta (the "Show Beta Features"
// toggle); a role a feed already states is always shown.
//
// An absent rel means "not stated". MSP never writes a default role, so an index
// does not show a guess as a fact.

/**
 * The role tokens MSP offers: the 8 starting tokens of podcast-namespace PR
 * #793, in its order, then the 5 music roles that the role feed generator at
 * phafe.com/roles-feed-generator also offers (issue #182). An album can match a
 * role feed only when both name the same token, so these must stay spelled as
 * that tool spells them. A person can also type a custom role (customRoleToken).
 */
export const ROLE_TOKENS = [
  { value: 'artist', label: 'Artist' },
  { value: 'host', label: 'Host' },
  { value: 'author', label: 'Author' },
  { value: 'label', label: 'Label' },
  { value: 'producer', label: 'Producer' },
  { value: 'network', label: 'Network' },
  { value: 'hosting', label: 'Hosting' },
  { value: 'sponsor', label: 'Sponsor' },
  { value: 'songwriter', label: 'Songwriter' },
  { value: 'composer', label: 'Composer' },
  { value: 'musician', label: 'Musician' },
  { value: 'studio', label: 'Studio' },
  { value: 'engineer', label: 'Engineer' },
] as const;

/** The choices of the one-role control that sets a whole catalog at once. */
export const PUBLISHER_ROLES = [
  { value: '', label: 'Not stated' },
  ...ROLE_TOKENS,
] as const;

const KNOWN_TOKENS: readonly string[] = ROLE_TOKENS.map(role => role.value);

/**
 * The tokens of a rel value, with no duplicates. PR #793 separates tokens with
 * spaces; a comma is read as a separator too, because some feeds wrote one
 * before the PR. A known token is matched in any letter case and given in
 * lower case; an unknown token is kept as written. Known tokens come first, in
 * the order of ROLE_TOKENS, then unknown ones in their order.
 */
export function roleTokens(rel: string | undefined): string[] {
  const known = new Set<string>();
  const unknown: string[] = [];
  for (const token of (rel ?? '').split(/[\s,]+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (KNOWN_TOKENS.includes(lower)) {
      known.add(lower);
    } else if (!unknown.some(existing => existing.toLowerCase() === lower)) {
      unknown.push(token);
    }
  }
  return [...KNOWN_TOKENS.filter(token => known.has(token)), ...unknown];
}

/** The longest custom role token MSP writes. */
export const MAX_CUSTOM_ROLE_LENGTH = 40;

/**
 * A custom role typed by a person, as one rel token, or '' when nothing usable
 * is left. A rel value is a space-separated set, so a role of several words
 * ("mastering engineer") becomes one token with hyphens ("mastering-engineer");
 * a space would split it into two roles. Letters are lowered, and only
 * letters, digits and hyphens are kept, so the token reads the same in every
 * feed. A known token typed in another case gives the known token.
 */
export function customRoleToken(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s,_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_CUSTOM_ROLE_LENGTH)
    .replace(/^-+|-+$/g, '');
}

/** The rel value in its canonical form: roleTokens joined by spaces ('' for not stated). */
export function normalizeRel(rel: string | undefined): string {
  return roleTokens(rel).join(' ');
}

/**
 * Whether two rel values name the same set of tokens. PR #793 requires that of
 * the two sides of a publisher link, in any order. Letter case is ignored, as
 * roleTokens ignores it; the PR doesn't say.
 */
export function sameRoles(a: string | undefined, b: string | undefined): boolean {
  const tokenSet = (rel: string | undefined) => roleTokens(rel).map(token => token.toLowerCase()).sort().join(' ');
  return tokenSet(a) === tokenSet(b);
}

/**
 * The rel value with `token` turned on or off, in the canonical form. Gives ''
 * when no token is left, which means "not stated".
 */
export function withRoleToken(rel: string | undefined, token: string, on: boolean): string {
  const lower = token.toLowerCase();
  const rest = roleTokens(rel).filter(existing => existing.toLowerCase() !== lower);
  return normalizeRel([...rest, ...(on ? [token] : [])].join(' '));
}

/**
 * The role every catalog item states, in the canonical form: '' when none
 * states one (or the catalog is empty), or null when the items differ. Items
 * are compared as token sets, so "producer artist" and "artist, producer" are
 * the same role.
 */
export function catalogRole(items: RemoteItem[]): string | null {
  const roles = new Set(items.map(item => normalizeRel(item.rel)));
  if (roles.size === 0) return '';
  if (roles.size === 1) return [...roles][0];
  return null;
}

/**
 * The item (a catalog feed, or an album's publisher reference) with `rel` set
 * to the role, or with no `rel` when the role is ''.
 */
export function withRole<T extends { rel?: string }>(item: T, role: string): T {
  const next: T = { ...item };
  if (role) {
    next.rel = role;
  } else {
    delete next.rel;
  }
  return next;
}
