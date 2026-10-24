// Which catalog albums an artist actually controls.
//
// A publisher feed lists albums, and each album points back with
// <podcast:publisher>. Only someone who can edit the album feed can write that
// link back, so it is the proof the two belong together. Albums on a platform
// that writes the feed for the artist (Wavlake, Fountain) can never be given a
// reliable link back, so MSP refuses new ones and warns about existing ones.
// Everything else is allowed: MSP writes the link into MSP-hosted albums when
// the artist publishes, and a self-hosting artist uploads the Download Catalog
// copy themselves — MSP trusts them to.
//
// Two real feeds shaped these rules (checked 2026-10-18). Longy's Wavlake
// albums "point back" only because Longy's own publisher feed reuses the GUID
// of Longy's Wavlake artist page; the URL in those tags still names Wavlake.
// And "Into the Valueverse 1" names Nathan Abbott's publisher feed, which MSP
// must never overwrite on another artist's behalf.
import { publisherParties, sameGuid } from './publisherParties';
import { normalizeRel, roleTokens, sameRoles } from './publisherRole';
import type { Album, RemoteItem } from '../types/feed';
import { fetchFeedFromUrl, parseRssFeed } from './xmlParser';
import { apiFetch } from './api';

export interface PlatformHost {
  domain: string;
  name: string;
}

export const PLATFORM_HOSTS: readonly PlatformHost[] = [
  { domain: 'wavlake.com', name: 'Wavlake' },
  { domain: 'fountain.fm', name: 'Fountain' },
];

/** The platform that hosts this feed URL, or null for MSP, self-hosted and unparsable URLs. */
export function getPlatformHost(url: string | undefined): PlatformHost | null {
  if (!url) return null;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return PLATFORM_HOSTS.find(h => hostname === h.domain || hostname.endsWith(`.${h.domain}`)) ?? null;
}

// Helper to check if a feed URL is MSP-hosted
export const isMspHosted = (url: string): boolean => {
  if (!url) return false;
  return (
    url.includes('/api/hosted/') ||
    url.includes('musicsideproject.com') ||
    url.includes('msp.podtards.com') ||
    url.includes('msp-2-0')
  );
};

// Helper to extract feedId from MSP hosted URL
export const extractFeedIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/api\/hosted\/([a-zA-Z0-9-]+)(?:\.xml)?/);
  return match ? match[1] : null;
};

// sameGuid lives with the other publisher-identity rules; re-exported for the
// callers that have always imported it from here.
export { sameGuid };

// `albumRel` is the role the album states on its link to this publisher, kept so
// the link can be compared with the catalog row's role (withRoleCheck).
export type LinkBackResult =
  | { status: 'linked'; albumRel?: string }
  | { status: 'role-mismatch'; albumRel: string; catalogRel: string }
  | { status: 'other'; publisherGuid: string; publisherUrl?: string }
  | { status: 'none' }
  | { status: 'unknown' };

/**
 * Does this album feed point back to the publisher? Only the GUID is compared:
 * the URL in the tag may be an older address of the same publisher feed, and the
 * one case where the URL is plainly wrong (Wavlake) is refused by host anyway.
 * Every party counts (utils/publisherParties.ts): an album that names its artist
 * first and this label second points back to the label too.
 */
export function classifyLinkBack(xml: string, publisherGuid: string): LinkBackResult {
  let album;
  try {
    album = parseRssFeed(xml);
  } catch {
    return { status: 'unknown' };
  }
  return classifyAlbumLinkBack(album, publisherGuid);
}

/**
 * classifyLinkBack for an album already parsed. 'other' is an album that is
 * another publisher's claim, which the catalog flows leave unchanged.
 */
export function classifyAlbumLinkBack(
  album: Pick<Album, 'publisher' | 'additionalPublishers'>,
  publisherGuid: string
): Exclude<LinkBackResult, { status: 'unknown' | 'role-mismatch' }> {
  const parties = publisherParties(album);
  const mine = parties.find(party => sameGuid(party.feedGuid, publisherGuid));
  if (mine) return roleTokens(mine.rel).length > 0 ? { status: 'linked', albumRel: mine.rel } : { status: 'linked' };
  const other = parties.find(party => party.feedGuid?.trim());
  if (!other) return { status: 'none' };
  return {
    status: 'other',
    publisherGuid: other.feedGuid.trim(),
    ...(other.feedUrl ? { publisherUrl: other.feedUrl } : {})
  };
}

/**
 * A link back counts only when its two sides agree on the roles (podcast-namespace
 * PR #793): if the album and the catalog row both state rel, they must name the
 * same set of tokens, or apps discard the link. If either side states none, it
 * is a plain publisher link. Applied when the result is shown, against the row's
 * current rel, so a role changed in the editor after the check shows at once.
 */
export function withRoleCheck(result: LinkBackResult, catalogRel: string | undefined): LinkBackResult {
  if (result.status !== 'linked' || !result.albumRel || roleTokens(catalogRel).length === 0) return result;
  if (sameRoles(result.albumRel, catalogRel)) return result;
  return { status: 'role-mismatch', albumRel: result.albumRel, catalogRel: catalogRel ?? '' };
}

/**
 * Fetch a catalog album's XML. MSP-hosted albums are read from this site's own
 * /api/hosted path: the canonical URL would go through /api/proxy-feed, which
 * allows 60 requests an hour per IP and is needed for the self-hosted ones.
 *
 * `no-store` because that path is served `public, max-age=300` and the editor
 * reads every MSP album on open: a cached copy made a publish regenerate an
 * album from its pre-edit XML. (The blob CDN behind it can still be up to 60 s
 * stale after a write — see CLAUDE.md — so post-publish status comes from the
 * publish results, not from re-reading.)
 */
export async function fetchCatalogFeedXml(feedUrl: string): Promise<string> {
  const feedId = isMspHosted(feedUrl) ? extractFeedIdFromUrl(feedUrl) : null;
  if (!feedId) return fetchFeedFromUrl(feedUrl);

  const response = await apiFetch(`/api/hosted/${feedId}.xml`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Hosted feed not found (HTTP ${response.status})`);
  return response.text();
}

/** Check one catalog row. Rows with no URL and platform rows are never fetched. */
export async function checkAlbumLinkBack(
  item: RemoteItem,
  publisherGuid: string,
  fetchXml: (feedUrl: string) => Promise<string> = fetchCatalogFeedXml
): Promise<LinkBackResult> {
  if (!item.feedUrl || getPlatformHost(item.feedUrl)) return { status: 'unknown' };
  try {
    return classifyLinkBack(await fetchXml(item.feedUrl), publisherGuid);
  } catch {
    return { status: 'unknown' };
  }
}

/** Shown in place of Add for a platform album found by search. */
export function platformRefusal({ name }: PlatformHost): string {
  return `Hosted on ${name}. ${name} writes this feed for you, so it can't point back to your publisher feed. ` +
    `To use this album: import it into MSP from its URL (that keeps its GUID), host it on MSP or on your own host, ` +
    `then remove the ${name} copy, or ask ${name} to remove it. Then add the new copy here.`;
}

/** Shown on a platform album that is already in the catalog. */
export function platformWarning({ name }: PlatformHost): string {
  return `Hosted on ${name}. You can't edit this feed, so it can't reliably point back to this publisher feed. ` +
    `To fix it: import the album into MSP from its URL (that keeps its GUID), host it on MSP or on your own host, ` +
    `remove the ${name} copy, or ask ${name} to remove it, then delete this row and add the new copy from Search Directory.`;
}

/**
 * `addsParty`: the beta multi-publisher feature is on, so publish and Download
 * Catalog add this publisher to an album that names another one instead of
 * leaving it alone (utils/publisherParties.ts, linkPublisher).
 */
export function linkBackMessage(result: LinkBackResult, onMsp: boolean, addsParty = false): string {
  switch (result.status) {
    case 'linked':
      return 'Points back to this publisher feed.';
    case 'role-mismatch':
      return `Points back to this publisher feed, but with other roles: the album says "${normalizeRel(result.albumRel)}", ` +
        `this catalog says "${normalizeRel(result.catalogRel)}". Apps ignore a link whose two sides name different roles. ` +
        (onMsp
          ? "Publish to write this catalog's roles into the album, or change the roles here to match."
          : "Download this album's new version in Download Catalog and upload it to your host, or change the roles here to match.");
    case 'none':
      return onMsp
        ? 'Not linked yet. MSP adds the link back when you publish.'
        : "Not linked yet. Download this album's new version in Download Catalog and upload it to your host.";
    case 'other':
      if (addsParty) {
        return `This album names a different publisher feed (${result.publisherGuid}). With Beta Features on, ` + (onMsp
          ? 'MSP adds this publisher as another publisher of the album when you publish, and keeps that one.'
          : "the album's new version in Download Catalog names both publishers. Upload it only if you control this album.");
      }
      return `This album names a different publisher feed (${result.publisherGuid}). An album can name only one publisher, ` +
        'so MSP leaves it alone. Ask the owner of that publisher feed if it should move.';
    case 'unknown':
      return `Couldn't read this album's feed. Try "Check links back" again later.`;
  }
}
