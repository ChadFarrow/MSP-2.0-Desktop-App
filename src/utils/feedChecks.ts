// Feed health checks — the rules behind the Feed check panel AND the Save gate.
//
// One rule list serves both on purpose: the panel's "Must fix before publishing"
// group and the Save modal's "Missing required fields" refusal are the same
// function, so the panel can never say "nothing to fix" while Save refuses, or
// the other way round. (Same principle as feedProbe.ts serving both the URL
// advisory and the submit guard.)
//
// Everything here is pure and runs in node, so it is unit-tested directly.
import type { Album, FeedType, PublisherFeed, Track } from '../types/feed';
import { getValueRecipientErrors } from './valueValidation';
import { hhmmssToSeconds } from './audioUtils';
import { trackOrderIssue } from './trackOrder';
import { collectLinkTargets, summarizeLinks, type LinkResult, type LinkSummary, type LinkTarget } from './linkCheck';

export type IssueLevel = 'must' | 'should' | 'outdated';

/** Where an issue lives in the editor; with `trackId` it names one track. */
export type IssueArea = 'feed' | 'artwork' | 'value' | 'tracks' | 'catalog' | 'file';

export type IssueCode =
  // Must fix — the Save gate
  | 'missing-author'
  | 'missing-title'
  | 'missing-description'
  | 'missing-image'
  | 'missing-language'
  | 'missing-guid'
  | 'guid-not-uuid'
  | 'recipient-split'
  | 'track-missing-title'
  | 'track-missing-duration'
  | 'track-missing-url'
  | 'track-missing-size'
  // Should fix — live rules
  | 'duration-zero'
  | 'guid-duplicate'
  | 'url-whitespace'
  | 'url-scheme'
  | 'url-http'
  | 'video-audio-type'
  | 'transcript-type'
  | 'channel-link-missing'
  | 'track-order'
  // Should fix — link check
  | 'link-broken'
  | 'artwork-not-square'
  | 'artwork-size'
  // Should fix — the source feed (feedInspect.ts)
  | 'xml-malformed'
  | 'value-blocks-multiple'
  | 'transcripts-multiple'
  | 'publisher-items-dropped'
  // Updated by MSP when you save — the source feed (feedInspect.ts)
  | 'explicit-legacy'
  | 'medium-missing'
  | 'medium-changed'
  | 'podcast-images-plural'
  | 'remote-item-title-text'
  | 'image-link-missing'
  | 'publisher-ref-shape'
  | 'legacy-msp-node'
  | 'recipient-type'
  | 'split-not-integer'
  | 'enclosure-length-placeholder'
  | 'item-guid-missing'
  | 'pubdate-missing'
  | 'language-missing';

export interface FeedIssue {
  code: IssueCode;
  level: IssueLevel;
  /** One plain sentence, fix hint included. */
  message: string;
  area: IssueArea;
  /** The track this is about. Labels are computed from it at render, so a reorder never leaves "Track 3" pointing at the wrong row. */
  trackId?: string;
  /** Source findings only: the item's position in the imported document, before binding to a trackId. */
  itemIndex?: number;
  /** Must-fix only: the exact token the Save modal joins into "Missing required fields: …". */
  saveLabel?: string;
}

/** The slice of feed state the checks read. */
export interface FeedSnapshot {
  feedType: FeedType;
  album: Album;
  publisherFeed: PublisherFeed | null;
}

/**
 * Which destination the Save gate is checking for.
 * - `publish`: every validating destination (Nostr, Blossom, nsite, hosted update)
 * - `nostrMusic`: kind 36787 carries no description, file size or duration
 * - `hostedCreate`: a new Host on MSP feed, whose id is the GUID and must be a UUID
 *
 * Invariant (tested): nostrMusic ⊆ publish ⊆ hostedCreate. The panel shows
 * hostedCreate, so it never reports a clean feed that some destination refuses.
 */
export type SaveTarget = 'publish' | 'nostrMusic' | 'hostedCreate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Same test as the server's `isValidFeedId` (api/_utils/feedUtils.ts), which
 * src/ can't import. Deliberately not trimmed: the Save modal sends the GUID as
 * typed, and the server tests it raw.
 */
export function isUuidGuid(guid: string): boolean {
  return UUID_RE.test(guid);
}

const blank = (value: string | undefined): boolean => !value?.trim();

function isPublisherSnapshot(feed: FeedSnapshot): feed is FeedSnapshot & { publisherFeed: PublisherFeed } {
  return feed.feedType === 'publisher' && !!feed.publisherFeed;
}

/**
 * The Save gate. Rules, order and labels are the ones SaveModal carried inline
 * before this file existed; a parity test pins them.
 */
export function getSaveBlockers(feed: FeedSnapshot, target: SaveTarget): FeedIssue[] {
  const issues: FeedIssue[] = [];
  const add = (code: IssueCode, area: IssueArea, saveLabel: string, message: string, trackId?: string) => {
    issues.push({ code, level: 'must', area, saveLabel, message, ...(trackId ? { trackId } : {}) });
  };
  const addRecipientErrors = (recipients: Album['value']['recipients'] | undefined, saveLabelPrefix: string, area: IssueArea, trackId?: string) => {
    const saveLabels = getValueRecipientErrors(recipients, saveLabelPrefix);
    const messages = getValueRecipientErrors(recipients, 'Value recipient');
    saveLabels.forEach((saveLabel, i) => add('recipient-split', area, saveLabel, `${messages[i]}.`, trackId));
  };
  const addGuidRules = (guid: string, label: string) => {
    if (blank(guid)) {
      add('missing-guid', 'feed', label, `${label} is empty.`);
    } else if (target === 'hostedCreate' && !isUuidGuid(guid)) {
      add(
        'guid-not-uuid',
        'feed',
        `${label} (must be a UUID to host on MSP)`,
        `${label} is not a UUID, so Host on MSP will refuse it. Use the "New" button beside the field to make one — apps then see it as a new feed.`
      );
    }
  };

  if (isPublisherSnapshot(feed)) {
    const publisher = feed.publisherFeed;
    if (blank(publisher.author)) add('missing-author', 'feed', 'Artist Name', 'Artist Name is empty.');
    if (blank(publisher.title)) add('missing-title', 'feed', 'Catalog Title', 'Catalog Title is empty.');
    if (blank(publisher.description)) add('missing-description', 'feed', 'Description', 'Description is empty.');
    addGuidRules(publisher.podcastGuid, 'Publisher GUID');
    // Every value recipient needs a non-zero split or its sats silently redistribute.
    addRecipientErrors(publisher.value?.recipients, 'Value recipient', 'value');
    return issues;
  }

  const { album } = feed;
  const isVideo = feed.feedType === 'video';
  // Nostr Music (kind 36787 / 34139) doesn't carry description, file size, or
  // require numeric duration — skip those so imported Nostr Music albums can be
  // re-published without adding fields the events don't use.
  const isNostrMusic = target === 'nostrMusic';

  if (blank(album.author)) add('missing-author', 'feed', 'Artist/Band', 'Artist/Band is empty.');
  if (blank(album.title)) add('missing-title', 'feed', 'Album Title', 'Album Title is empty.');
  if (!isNostrMusic && blank(album.description)) add('missing-description', 'feed', 'Description', 'Description is empty.');
  if (blank(album.imageUrl)) add('missing-image', 'artwork', 'Album Art URL', 'Album Art URL is empty.');
  if (blank(album.language)) add('missing-language', 'feed', 'Language', 'Language is empty.');
  addGuidRules(album.podcastGuid, 'Podcast GUID');

  // Feed-level value recipients: every one needs a non-zero split.
  addRecipientErrors(album.value?.recipients, 'Value recipient', 'value');

  const itemLabel = isVideo ? 'Video' : 'Track';
  const urlLabel = isVideo ? 'Video URL' : 'MP3 URL';
  album.tracks.forEach((track, i) => {
    const prefix = `${itemLabel} ${i + 1}`;
    if (blank(track.title)) add('track-missing-title', 'tracks', `${prefix} Title`, 'Title is empty.', track.id);
    if (!isNostrMusic && blank(track.duration)) add('track-missing-duration', 'tracks', `${prefix} Duration`, 'Duration is empty.', track.id);
    if (blank(track.enclosureUrl)) add('track-missing-url', 'tracks', `${prefix} ${urlLabel}`, `${urlLabel} is empty.`, track.id);
    if (!isNostrMusic && blank(track.enclosureLength)) add('track-missing-size', 'tracks', `${prefix} File Size`, 'File Size is empty.', track.id);
    // Per-track value recipients (optional block, but if present each needs a split).
    addRecipientErrors(track.value?.recipients, `${prefix} value recipient`, 'tracks', track.id);
  });

  return issues;
}

/** The Save modal's refusal text — unchanged from before the rules moved here. */
export function formatSaveBlockers(issues: FeedIssue[]): string {
  return `Missing required fields: ${issues.map(issue => issue.saveLabel ?? issue.message).join(', ')}`;
}

// A URL that is present but will cause trouble in podcast apps. Empty URLs are the
// Save gate's business, so nothing here duplicates a must-fix item.
function urlIssues(url: string | undefined, label: string, area: IssueArea, trackId?: string): FeedIssue[] {
  const value = url?.trim();
  if (!value) return [];
  const base = { level: 'should' as const, area, ...(trackId ? { trackId } : {}) };
  if (/\s/.test(value)) {
    return [{ ...base, code: 'url-whitespace', message: `${label} contains a space. Rename the file at your host so its URL has none; apps fail to load URLs with spaces.` }];
  }
  if (!/^https?:\/\//i.test(value)) {
    return [{ ...base, code: 'url-scheme', message: `${label} is not a web address. It must start with https://.` }];
  }
  if (/^http:\/\//i.test(value)) {
    return [{ ...base, code: 'url-http', message: `${label} uses http://. Use https:// if your host supports it; some apps refuse http links.` }];
  }
  return [];
}

/**
 * Live "Should fix" rules: things that pass the Save gate but break, or will
 * break, the feed in apps or validators. Harmless extras are never flagged.
 */
export function getShouldFixIssues(feed: FeedSnapshot): FeedIssue[] {
  const issues: FeedIssue[] = [];
  const should = (code: IssueCode, area: IssueArea, message: string, trackId?: string) => {
    issues.push({ code, level: 'should', area, message, ...(trackId ? { trackId } : {}) });
  };

  if (isPublisherSnapshot(feed)) {
    const publisher = feed.publisherFeed;
    if (blank(publisher.link)) {
      should('channel-link-missing', 'feed', 'Website is empty. RSS 2.0 requires a channel <link>, so validators report the feed as invalid without one.');
    }
    issues.push(...urlIssues(publisher.imageUrl, 'Publisher artwork URL', 'artwork'));
    return issues;
  }

  const { album } = feed;
  const isVideo = feed.feedType === 'video';
  const itemWord = isVideo ? 'video' : 'track';
  const urlLabel = isVideo ? 'Video URL' : 'MP3 URL';

  if (blank(album.link)) {
    should('channel-link-missing', 'feed', 'Website is empty. RSS 2.0 requires a channel <link>, so validators report the feed as invalid without one.');
  }
  issues.push(...urlIssues(album.imageUrl, 'Album art URL', 'artwork'));

  const firstWithGuid = new Map<string, number>();
  album.tracks.forEach((track, i) => {
    if (!blank(track.duration) && hhmmssToSeconds(track.duration) === null) {
      should('duration-zero', 'tracks', `Duration is ${track.duration.trim()}. Enter the real length (HH:MM:SS); apps show 0:00 and some skip the ${itemWord}.`, track.id);
    }

    const guid = track.guid?.trim();
    if (guid) {
      const first = firstWithGuid.get(guid);
      if (first === undefined) {
        firstWithGuid.set(guid, i);
      } else {
        should('guid-duplicate', 'tracks', `Has the same GUID as ${isVideo ? 'Video' : 'Track'} ${first + 1}. Apps treat ${itemWord}s with one GUID as the same episode, so one of them disappears.`, track.id);
      }
    }

    issues.push(...urlIssues(track.enclosureUrl, urlLabel, 'tracks', track.id));
    issues.push(...urlIssues(track.trackArtUrl, 'Track art URL', 'tracks', track.id));

    if (isVideo && track.enclosureType?.startsWith('audio/')) {
      should('video-audio-type', 'tracks', `Its file type is ${track.enclosureType}, an audio type. Paste the video URL again so MSP sets the video type.`, track.id);
    }

    if (track.transcriptUrl?.trim() && track.transcriptType === 'application/srt') {
      should('transcript-type', 'tracks', 'Lyrics type is application/srt, which is not in the Podcasting 2.0 spec. Choose "SubRip (.srt)" in the lyrics type list.', track.id);
    }
  });

  const order = trackOrderIssue(album.tracks);
  if (order === 'reversed') {
    should('track-order', 'tracks', `The ${itemWord}s look like they are in reverse order. Use "Reverse order" at the top of the ${isVideo ? 'Videos' : 'Tracks'} section.`);
  } else if (order === 'dates') {
    should('track-order', 'tracks', `Pub dates don't match the ${itemWord} order, so apps may play them out of order. Use "Fix pub dates" at the top of the ${isVideo ? 'Videos' : 'Tracks'} section.`);
  }

  return issues;
}

// Apple Podcasts' cover-art rule, which other apps follow: square, 1400–3000 px.
export const ARTWORK_MIN_PX = 1400;
export const ARTWORK_MAX_PX = 3000;

/**
 * Link-check results as issues, for the feed's CURRENT links only — a result
 * for a URL the user has since replaced is ignored. One issue per URL, however
 * many tracks share it. Extra <podcast:image>s are wide by design (banner,
 * canvas), so they are checked for reachability only, never for shape.
 */
export function linkIssues(targets: LinkTarget[], links: Record<string, LinkResult>, feed: FeedSnapshot): FeedIssue[] {
  const issues: FeedIssue[] = [];
  const isVideo = feed.feedType === 'video';
  const coverLabel = feed.feedType === 'publisher' ? 'Publisher artwork' : isVideo ? 'Video artwork' : 'Album art';

  for (const target of targets) {
    const result = links[target.url];
    if (!result) continue;
    // A URL used as the cover too (track art often is) is reported once, as the cover.
    const trackId = target.trackIds[0];
    const where: { area: IssueArea; trackId?: string } =
      target.roles.includes('artwork') || !trackId ? { area: 'artwork' } : { area: 'tracks', trackId };
    const label = target.roles.includes('enclosure') ? (isVideo ? 'The video file' : 'The audio file')
      : target.roles.includes('artwork') ? coverLabel
        : target.roles.includes('trackArt') ? `The ${isVideo ? 'video' : 'track'} art`
          : 'An extra image (podcast:image)';

    if (result.status === 'broken') {
      issues.push({
        ...where, code: 'link-broken', level: 'should',
        message: `${label} didn't load in your browser (${target.url}). Check the file is still at that address; podcast apps will fail the same way.`
      });
      continue;
    }

    const isCover = target.roles.includes('artwork') || target.roles.includes('trackArt');
    if (result.status !== 'ok' || !isCover || !result.width || !result.height) continue;
    const size = `${result.width}×${result.height}`;
    if (result.width !== result.height) {
      issues.push({ ...where, code: 'artwork-not-square', level: 'should', message: `${label} is ${size}. Apps crop or letterbox art that isn't square; use a square image of ${ARTWORK_MIN_PX}–${ARTWORK_MAX_PX} px.` });
    } else if (result.width < ARTWORK_MIN_PX || result.width > ARTWORK_MAX_PX) {
      issues.push({ ...where, code: 'artwork-size', level: 'should', message: `${label} is ${size}. Apple Podcasts and others want ${ARTWORK_MIN_PX}–${ARTWORK_MAX_PX} px square.` });
    }
  }
  return issues;
}

export interface FeedCheckReport {
  must: FeedIssue[];
  should: FeedIssue[];
  outdated: FeedIssue[];
  links: LinkSummary;
}

// Editor order, so the panel reads top to bottom like the page below it.
const AREA_ORDER: Record<IssueArea, number> = { file: 0, feed: 1, artwork: 2, value: 3, catalog: 4, tracks: 5 };

function inEditorOrder(issues: FeedIssue[], feed: FeedSnapshot): FeedIssue[] {
  const trackIndex = new Map(feed.album.tracks.map((track, i) => [track.id, i]));
  const rank = (issue: FeedIssue) => {
    const index = issue.trackId === undefined ? undefined : trackIndex.get(issue.trackId);
    return index === undefined ? AREA_ORDER[issue.area] : AREA_ORDER.tracks + 1 + index;
  };
  return issues
    .map((issue, i) => ({ issue, i, rank: rank(issue) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ issue }) => issue);
}

/** Everything the Feed check panel shows, computed from the current feed. */
export function checkFeed(feed: FeedSnapshot, sourceFindings: FeedIssue[], links: Record<string, LinkResult>): FeedCheckReport {
  const targets = collectLinkTargets(feed);
  const source = openSourceFindings(sourceFindings, feed);
  const all = inEditorOrder([
    ...getSaveBlockers(feed, 'hostedCreate'),
    ...getShouldFixIssues(feed),
    ...linkIssues(targets, links, feed),
    ...source
  ], feed);
  return {
    must: all.filter(issue => issue.level === 'must'),
    should: all.filter(issue => issue.level === 'should'),
    outdated: all.filter(issue => issue.level === 'outdated'),
    links: summarizeLinks(targets, links)
  };
}

/**
 * Tie source findings (feedInspect.ts) to the tracks they describe. The parser
 * keeps document order, so item N is track N right after the import; from then
 * on the finding follows the track's id through any reorder.
 */
export function bindSourceFindings(findings: FeedIssue[], tracks: Track[]): FeedIssue[] {
  return findings.map(finding => {
    if (finding.itemIndex === undefined) return finding;
    const track = tracks[finding.itemIndex];
    return track ? { ...finding, trackId: track.id } : finding;
  });
}

/**
 * The source findings still worth showing. A finding about a deleted track goes,
 * and the two "MSP couldn't read this" findings go once the user has re-entered
 * what was lost. The rest describe the imported file and stay as they are.
 */
export function openSourceFindings(findings: FeedIssue[], feed: FeedSnapshot): FeedIssue[] {
  const isPublisher = feed.feedType === 'publisher';
  // One lookup table per call: this runs on every render while the panel is open,
  // and a large feed can carry a finding for most of its tracks.
  const tracksById = new Map(feed.album.tracks.map(track => [track.id, track]));
  const trackOf = (finding: FeedIssue) => (finding.trackId ? tracksById.get(finding.trackId) : undefined);
  return findings.filter(finding => {
    if (finding.trackId && !isPublisher && !trackOf(finding)) return false;
    switch (finding.code) {
      case 'value-blocks-multiple': {
        if (finding.trackId) {
          const track = trackOf(finding);
          return !(track?.overrideValue && track.value?.recipients.length);
        }
        const recipients = isPublisher ? feed.publisherFeed?.value.recipients : feed.album.value.recipients;
        return !recipients?.length;
      }
      case 'transcripts-multiple':
        return !trackOf(finding)?.transcriptUrl?.trim();
      default:
        return true;
    }
  });
}

/** "Album Info", "Track 3", … — computed from the current feed, never stored. */
export function issueLocationLabel(issue: FeedIssue, feed: FeedSnapshot): string {
  const isPublisher = feed.feedType === 'publisher';
  const isVideo = feed.feedType === 'video';
  if (issue.trackId && !isPublisher) {
    const index = feed.album.tracks.findIndex((track: Track) => track.id === issue.trackId);
    if (index >= 0) return `${isVideo ? 'Video' : 'Track'} ${index + 1}`;
  }
  switch (issue.area) {
    case 'feed': return isPublisher ? 'Publisher Info' : isVideo ? 'Video Info' : 'Album Info';
    case 'artwork': return isPublisher ? 'Publisher Artwork' : isVideo ? 'Video Artwork' : 'Album Artwork';
    case 'value': return 'Value Block';
    case 'tracks': return isVideo ? 'Videos' : 'Tracks';
    case 'catalog': return 'Catalog Feeds';
    case 'file': return 'Feed file';
  }
}
