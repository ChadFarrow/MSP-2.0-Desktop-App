import type { Album, PublisherReference } from '../types/feed';
import { normalizeFeedUrl } from './urlValidation';

// An album can name more than one publisher feed: the artist and the label
// that released it, or two artists. Each party is one
// <podcast:remoteItem medium="publisher"> inside <podcast:publisher>, the
// primary party first. podcast-namespace PR #793 proposes this; the current
// spec says the element holds exactly one item.
//
// MSP keeps the first party in `album.publisher` and the rest in
// `album.additionalPublishers`, so albums saved before this change load as
// they are. Whatever MSP does with the parties, it never drops one: the
// publish and Download Catalog flows are parse→regenerate over someone else's
// album feed.

type PublisherFields = Pick<Album, 'publisher' | 'additionalPublishers'>;

/** GUIDs compare trimmed and case-insensitively; two empty GUIDs are not the same feed. */
export function sameGuid(a: string | undefined, b: string | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase();
  const y = (b ?? '').trim().toLowerCase();
  return x !== '' && x === y;
}

/** A feed URL in the form compared for identity: edges trimmed, case folded. */
export function urlKey(url: string | undefined): string {
  return normalizeFeedUrl(url ?? '').toLowerCase();
}

/** True when the reference names a feed at all (a GUID or a URL). */
export function isUsableParty(party: PublisherReference | undefined): party is PublisherReference {
  return !!party && !!(party.feedGuid?.trim() || party.feedUrl?.trim());
}

/**
 * Every party the album names, primary first. Empty when it names none. A
 * primary with neither a GUID nor a URL (the editor's cleared field) is left
 * out, so the generator writes the first other party first.
 */
export function publisherParties(album: PublisherFields): PublisherReference[] {
  return [album.publisher, ...(album.additionalPublishers ?? [])].filter(isUsableParty);
}

/** The two fields for a list of parties: the first is the primary party. */
export function fromParties(parties: PublisherReference[]): PublisherFields {
  const [primary, ...rest] = parties;
  return {
    publisher: primary,
    additionalPublishers: rest.length > 0 ? rest : undefined,
  };
}

/**
 * True when both references point at the same publisher feed: by GUID when
 * both have one, else by URL.
 */
export function samePublisher(a: PublisherReference, b: PublisherReference): boolean {
  if (a.feedGuid?.trim() && b.feedGuid?.trim()) return sameGuid(a.feedGuid, b.feedGuid);
  const url = urlKey(a.feedUrl);
  return url !== '' && url === urlKey(b.feedUrl);
}

/**
 * The album's publisher fields with this publisher's `party` set.
 *
 * - The same publisher (samePublisher) is replaced in place, so it keeps its
 *   position and every other party stays.
 * - An album that names no publisher gets `party` as its primary.
 * - An album whose parties name no GUID is treated as before parties existed:
 *   its primary is replaced, because a URL alone may be an older address of
 *   this same publisher feed (see classifyLinkBack).
 * - Otherwise `party` is added after the others.
 *
 * That last case is an album that names another publisher by GUID: someone
 * else's claim. Deciding whether to add to it is the caller's job — the catalog
 * flows leave it unchanged unless the beta multi-publisher feature is on.
 */
export function linkPublisher(album: PublisherFields, party: PublisherReference): PublisherFields {
  const parties = publisherParties(album);
  const index = parties.findIndex(existing => samePublisher(existing, party));
  if (index >= 0) {
    parties[index] = party;
    return fromParties(parties);
  }
  if (parties.length === 0) return fromParties([party]);
  if (!parties.some(existing => existing.feedGuid?.trim())) {
    parties[0] = party;
    return fromParties(parties);
  }
  return fromParties([...parties, party]);
}

/**
 * The album's publisher fields with `feedGuid` set on every party at
 * `feedUrl`, or null when that changes nothing (no party is at that URL any
 * more, or it already has that GUID). A Podcast Index lookup answers seconds
 * after it starts, so it names its party by URL, never by position: the user
 * may have edited, moved or removed it meanwhile.
 */
export function withPartyGuid(album: PublisherFields, feedUrl: string, feedGuid: string): PublisherFields | null {
  const url = urlKey(feedUrl);
  if (!url) return null;
  let changed = false;
  const set = (party: PublisherReference): PublisherReference => {
    if (urlKey(party.feedUrl) !== url || party.feedGuid === feedGuid) return party;
    changed = true;
    return { ...party, feedGuid };
  };
  const next: PublisherFields = {
    publisher: album.publisher && set(album.publisher),
    additionalPublishers: album.additionalPublishers?.map(set),
  };
  return changed ? next : null;
}
