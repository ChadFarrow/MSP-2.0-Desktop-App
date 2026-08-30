/**
 * Parsing and projection for Helipad boost records. No I/O — see boostStore.ts.
 *
 * Helipad posts `WebhookPayload { direction, ..BoostRecord }` (its src/triggers.rs).
 * Two properties of that payload drive everything here:
 *
 *   1. `tlv` is a JSON *string*, not an object, and its contents are written by the
 *      boosting app. Field sets differ wildly between apps, so every field inside is
 *      optional and a parse failure must not lose the boost.
 *   2. `action` exists twice with two types — a number in the outer body (Helipad's
 *      own ActionType) and a string inside the TLV (the app's word for it).
 *
 * The module also draws the privacy boundary: `ParsedBoost` holds everything,
 * including the listener's message and name, and is only ever written to the private
 * raw blob. `DerivedBoost` is what any endpoint may serve, and carries neither.
 */

/** Helipad's own name for what kind of payment this was. */
export type ActionName = 'stream' | 'boost' | 'auto' | 'invoice' | 'unknown';

/**
 * Which rung of the resolution ladder identified the track, best first. This is the
 * measurement phase 1 exists to produce: it says how good the track data actually is.
 */
export type TrackSource =
  | 'remote-guid'   // canonical: a podcast:remoteItem pair, joins to a feed
  | 'remote-title'  // Helipad resolved the guids to titles for us
  | 'boost-link'    // an app's own stable song URL
  | 'timesplit'     // nothing yet, but a playback position + show guid can resolve it later
  | 'message'       // scraped out of free text
  | 'none';

/**
 * Everything a boosting app might put in TLV record 7629169. All optional on purpose:
 * two real captures of this field share barely half their keys.
 */
export interface HelipadTlv {
  action?: string;
  app_name?: string;
  app_version?: string;
  name?: string;
  podcast?: string;
  episode?: string;
  guid?: string;
  episode_guid?: string;
  feedId?: number | string;
  url?: string;
  ts?: number;
  value_msat?: number;
  value_msat_total?: number;
  message?: string;
  sender_name?: string;
  sender_id?: string;
  reply_address?: string;
  remote_feed_guid?: string;
  remote_item_guid?: string;
  boost_link?: string;
  boost_uuid?: string;
  uuid?: string;
}

/** A normalized boost, listener fields included. Never serve this. */
export interface ParsedBoost {
  index: number;
  direction: 'incoming' | 'outgoing';
  ts: number;
  actionName: ActionName;
  valueMsat: number;
  valueMsatTotal: number;
  app: string;
  message: string;
  podcast: string;
  episode: string;
  remotePodcast?: string;
  remoteEpisode?: string;
  tlv: HelipadTlv;
}

export interface TrackResolution {
  trackSource: TrackSource;
  trackKey?: string;
  trackTitle?: string;
  trackArtist?: string;
  /** Whether a title could be scraped from the message, whatever rung was chosen. */
  hasMessageTitle: boolean;
}

/** The PII-free projection. Only this shape may leave an endpoint. */
export interface DerivedBoost {
  index: number;
  ts: number;
  direction: 'incoming' | 'outgoing';
  actionName: ActionName;
  valueMsat: number;
  valueMsatTotal: number;
  app: string;
  isMspSplit: boolean;
  showTitle?: string;
  showGuid?: string;
  showUrl?: string;
  episodeTitle?: string;
  episodeGuid?: string;
  remoteFeedGuid?: string;
  remoteItemGuid?: string;
  boostLink?: string;
  playbackTs?: number;
  trackSource: TrackSource;
  trackKey?: string;
  trackTitle?: string;
  trackArtist?: string;
  hasMessageTitle: boolean;
}

/**
 * The recipient name MSP writes into every generated feed's value block.
 *
 * Duplicated from COMMUNITY_SUPPORT_RECIPIENTS[0].name in src/types/feed.ts because
 * Vercel functions cannot import from src/ — the same arrangement urlValidation.ts
 * documents. Change it there and here together.
 */
export const MSP_SUPPORT_RECIPIENT_NAME = 'MSP 2.0';

/**
 * Helipad's numeric ActionType. Only the values its README states are mapped; an
 * unmapped number falls through to the TLV's own word rather than being guessed at.
 */
const ACTION_BY_NUMBER: Record<number, ActionName> = {
  1: 'stream',
  2: 'boost',
  4: 'auto'
};

const ACTION_NAMES: ActionName[] = ['stream', 'boost', 'auto', 'invoice'];

/**
 * A quoted title followed by an attribution, e.g.
 *   Auto boost from someone for "ACID" by Singles - Horseheads sent from v4vmusic.com
 *
 * Only double and smart double quotes delimit the title — an apostrophe cannot, or
 * every title containing one ("Don't Stop") would be cut in half. The optional
 * trailing clause strips the app's own "sent from …" advertisement.
 */
const MESSAGE_TRACK_RE = /["“”]([^"“”]{1,200})["“”]\s+by\s+(.{1,200}?)(?:\s+sent from\s+\S+)?\s*$/i;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/** Collapse a title or artist to a comparable key: no case, no accents, no punctuation. */
function normalizeForKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleKey(artist: string, title: string): string {
  return `title:${normalizeForKey(artist)}|${normalizeForKey(title)}`;
}

function resolveActionName(outerAction: unknown, tlvAction: unknown): ActionName {
  const numeric = asNumber(outerAction);
  if (numeric !== undefined && ACTION_BY_NUMBER[numeric]) return ACTION_BY_NUMBER[numeric];

  const word = asString(tlvAction)?.toLowerCase();
  if (word && (ACTION_NAMES as string[]).includes(word)) return word as ActionName;

  return 'unknown';
}

/** Parse the `tlv` string. A malformed or absent one yields {} — never a lost boost. */
function parseTlv(raw: unknown): HelipadTlv {
  const text = asString(raw);
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HelipadTlv)
      : {};
  } catch {
    return {};
  }
}

/**
 * Normalize one webhook body. Returns null when the payload carries no usable
 * `index`, because index is the dedup key and a record without one cannot be stored
 * idempotently.
 */
export function parseBoostPayload(body: unknown): ParsedBoost | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const index = asNumber(b.index);
  if (index === undefined) return null;

  const tlv = parseTlv(b.tlv);

  return {
    index,
    direction: b.direction === 'outgoing' ? 'outgoing' : 'incoming',
    ts: asNumber(b.time) ?? Math.floor(Date.now() / 1000),
    actionName: resolveActionName(b.action, tlv.action),
    valueMsat: asNumber(b.value_msat) ?? asNumber(tlv.value_msat) ?? 0,
    valueMsatTotal: asNumber(b.value_msat_total) ?? asNumber(tlv.value_msat_total) ?? 0,
    app: asString(b.app) ?? asString(tlv.app_name) ?? '',
    message: asString(b.message) ?? asString(tlv.message) ?? '',
    podcast: asString(b.podcast) ?? asString(tlv.podcast) ?? '',
    episode: asString(b.episode) ?? asString(tlv.episode) ?? '',
    remotePodcast: asString(b.remote_podcast),
    remoteEpisode: asString(b.remote_episode),
    tlv
  };
}

/** True when this payment is the MSP community-support split rather than some other recipient. */
export function isMspSplit(boost: ParsedBoost): boolean {
  return boost.tlv.name === MSP_SUPPORT_RECIPIENT_NAME;
}

function extractFromMessage(message: string): { title: string; artist: string } | null {
  const match = MESSAGE_TRACK_RE.exec(message);
  if (!match) return null;
  const title = match[1].trim();
  const artist = match[2].trim();
  if (!title || !artist) return null;
  return { title, artist };
}

/**
 * Walk the resolution ladder, best rung first, and report which one answered.
 *
 * A message-scraped title enriches the higher rungs where they have a stable key but
 * no human-readable name — that is why `boost-link` can still come back with a title.
 * `timesplit` deliberately returns no key: a playback offset is a pointer to resolve
 * later against the show's valueTimeSplits, not an identity. Inventing a key from it
 * would make two boosts seconds apart look like different tracks.
 */
export function resolveTrack(boost: ParsedBoost): TrackResolution {
  const { tlv } = boost;
  const fromMessage = extractFromMessage(boost.message);
  const hasMessageTitle = fromMessage !== null;

  if (tlv.remote_feed_guid && tlv.remote_item_guid) {
    return {
      trackSource: 'remote-guid',
      trackKey: `guid:${tlv.remote_feed_guid}:${tlv.remote_item_guid}`,
      trackTitle: boost.remoteEpisode ?? fromMessage?.title,
      trackArtist: boost.remotePodcast ?? fromMessage?.artist,
      hasMessageTitle
    };
  }

  if (boost.remotePodcast && boost.remoteEpisode) {
    return {
      trackSource: 'remote-title',
      trackKey: titleKey(boost.remotePodcast, boost.remoteEpisode),
      trackTitle: boost.remoteEpisode,
      trackArtist: boost.remotePodcast,
      hasMessageTitle
    };
  }

  if (tlv.boost_link) {
    return {
      trackSource: 'boost-link',
      trackKey: `link:${tlv.boost_link}`,
      trackTitle: fromMessage?.title,
      trackArtist: fromMessage?.artist,
      hasMessageTitle
    };
  }

  if (asNumber(tlv.ts) !== undefined && (tlv.guid || tlv.episode_guid)) {
    return { trackSource: 'timesplit', hasMessageTitle };
  }

  if (fromMessage) {
    return {
      trackSource: 'message',
      trackKey: titleKey(fromMessage.artist, fromMessage.title),
      trackTitle: fromMessage.title,
      trackArtist: fromMessage.artist,
      hasMessageTitle
    };
  }

  return { trackSource: 'none', hasMessageTitle };
}

/**
 * Project a parsed boost down to what may be served. Listener message, sender name,
 * sender id and reply address are dropped here and nowhere else — this function is
 * the privacy boundary, and a test asserts none of them survive it.
 */
export function toDerived(boost: ParsedBoost): DerivedBoost {
  const track = resolveTrack(boost);
  return {
    index: boost.index,
    ts: boost.ts,
    direction: boost.direction,
    actionName: boost.actionName,
    valueMsat: boost.valueMsat,
    valueMsatTotal: boost.valueMsatTotal,
    app: boost.app,
    isMspSplit: isMspSplit(boost),
    showTitle: boost.podcast || undefined,
    showGuid: asString(boost.tlv.guid),
    showUrl: asString(boost.tlv.url),
    episodeTitle: boost.episode || undefined,
    episodeGuid: asString(boost.tlv.episode_guid),
    remoteFeedGuid: asString(boost.tlv.remote_feed_guid),
    remoteItemGuid: asString(boost.tlv.remote_item_guid),
    boostLink: asString(boost.tlv.boost_link),
    playbackTs: asNumber(boost.tlv.ts),
    ...track
  };
}

/**
 * ISO-8601 week key, e.g. "2026-W35". Weekly because "top tracks this week" is the
 * unit the chart is meant to report, so the storage bucket and the product agree.
 * The week is zero-padded so the keys sort lexically.
 */
export function isoWeekKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Shift to the Thursday of this week — ISO assigns the week to whichever year
  // that Thursday falls in, which is what makes 1 Jan 2027 belong to 2026-W53.
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Calendar month key for the raw store, e.g. "2026-08". */
export function monthKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
