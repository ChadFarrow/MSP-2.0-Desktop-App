// MSP 2.0 - XML Parser for importing Demu RSS Feeds
import { XMLParser } from 'fast-xml-parser';
import type { Album, Track, Person, PersonGroup, ValueRecipient, ValueBlock, Funding, PublisherFeed, RemoteItem, PublisherReference, BaseChannelData, PodcastImage } from '../types/feed';
import { createEmptyTrack, LEGACY_MSP_NODE_PUBKEY, MSP_SUPPORT_RECIPIENT, DEFAULT_TRANSCRIPT_TYPE } from '../types/feed';
import { areValueBlocksStrictEqual, arePersonsEqual } from './comparison';
import { detectAddressType } from './addressUtils';
import { MIN_PLAUSIBLE_MEDIA_BYTES } from './audioUtils';
import { apiFetch } from './api';

// OP3 prefix pattern: https://op3.dev/e/ or https://op3.dev/e,pg=GUID/
export const OP3_PREFIX_RE = /^https:\/\/op3\.dev\/e(?:,[^/]*)?\//;

// Strip OP3 prefix from a URL, restoring the original URL
export function stripOp3Prefix(url: string): string {
  const stripped = url.replace(OP3_PREFIX_RE, '');
  // If the remaining URL doesn't start with a protocol, it was HTTPS
  if (!stripped.startsWith('http://') && !stripped.startsWith('https://')) {
    return `https://${stripped}`;
  }
  return stripped;
}

// Known channel keys that we explicitly parse (don't capture as unknown)
const KNOWN_CHANNEL_KEYS = new Set([
  'title',
  'description',
  'link',
  'language',
  'generator',
  'pubDate',
  'lastBuildDate',
  'managingEditor',
  'webMaster',
  'image',
  'item',
  'itunes:author',
  'itunes:category',
  'itunes:keywords',
  'itunes:explicit',
  'itunes:owner',
  'itunes:image',
  'podcast:guid',
  'podcast:medium',
  'podcast:locked',
  'podcast:person',
  'podcast:value',
  'podcast:funding',
  'podcast:publisher',
  'podcast:remoteItem',  // For publisher feeds
  'podcast:txt',  // For npub and other txt tags
  'podcast:image'
]);

// Album and video feeds don't model channel-level remoteItems (a podroll), so
// letting the key stay "known" for them meant it was neither parsed nor
// preserved — parseRssFeed never reads it, and being in the set above excludes
// it from unknownChannelElements. Since Download Feed is a parse→regenerate,
// that deleted a publisher's podroll from their album feeds. Dropping the key
// here lets it round-trip as an unknown element instead. The publisher path
// keeps the full set: it parses these into feed.remoteItems and would otherwise
// emit them twice.
const ALBUM_CHANNEL_KEYS = new Set(
  [...KNOWN_CHANNEL_KEYS].filter(key => key !== 'podcast:remoteItem')
);

// Known item keys that we explicitly parse (don't capture as unknown)
const KNOWN_ITEM_KEYS = new Set([
  'title',
  'description',
  'pubDate',
  'guid',
  'enclosure',
  'itunes:duration',
  'itunes:explicit',
  'itunes:image',
  'podcast:season',
  'podcast:episode',
  'podcast:images',
  'podcast:image',
  'podcast:transcript',
  'podcast:person',
  'podcast:value'
]);

// Parse XML string to Album object
export const parseRssFeed = (xmlString: string): Album => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true
  });

  const result = parser.parse(xmlString);
  const channel = result?.rss?.channel;

  if (!channel) {
    throw new Error('Invalid RSS feed: missing channel element');
  }

  // Parse common channel elements
  const common = parseCommonChannelElements(channel);

  // Create album with common elements
  const album: Album = {
    ...common,
    medium: (getText(channel['podcast:medium']) as 'music' | 'video') || 'music',
    bannerArtUrl: '',
    op3: false,
    unknownChannelElements: captureUnknownElements(channel, ALBUM_CHANNEL_KEYS),
    tracks: []
  };

  // Podcast Index tags
  album.podcastGuid = getText(channel['podcast:guid']) || '';
  album.medium = (getText(channel['podcast:medium']) as 'music' | 'video') || 'music';

  // Locked
  const locked = channel['podcast:locked'];
  if (locked) {
    album.locked = getText(locked) === 'yes';
    album.lockedOwner = getAttr(locked, 'owner') || '';
  }

  // Categories - handle both content format and text attribute format
  const categories = channel['itunes:category'];
  if (categories) {
    const catArray = Array.isArray(categories) ? categories : [categories];
    album.categories = catArray.map(c => getText(c) || getAttr(c, 'text')).filter(Boolean) as string[];
  }

  // Keywords
  album.keywords = getText(channel['itunes:keywords']) || '';

  // Explicit
  const explicitVal = channel['itunes:explicit'];
  album.explicit = explicitVal === true || explicitVal === 'true' || getText(explicitVal) === 'true';

  // Owner
  const owner = channel['itunes:owner'];
  if (owner) {
    album.ownerName = getText((owner as Record<string, unknown>)['itunes:name']) || '';
    album.ownerEmail = getText((owner as Record<string, unknown>)['itunes:email']) || '';
  }

  // Image
  const image = channel.image;
  if (image) {
    album.imageUrl = getText(image.url) || '';
    album.imageTitle = getText(image.title) || '';
    album.imageLink = getText(image.link) || '';
    album.imageDescription = getText(image.description) || '';
  }

  // iTunes image fallback
  const itunesImage = channel['itunes:image'];
  if (itunesImage && !album.imageUrl) {
    album.imageUrl = getAttr(itunesImage, 'href') || '';
  }

  // Contact
  album.managingEditor = getText(channel.managingEditor) || '';
  album.webMaster = getText(channel.webMaster) || '';

  // Persons
  album.persons = parsePersons(channel['podcast:person']);

  // Value block
  const value = channel['podcast:value'];
  if (value) {
    album.value = parseValueBlock(value);
  }

  // Funding
  const funding = channel['podcast:funding'];
  if (funding) {
    const fundingArray = Array.isArray(funding) ? funding : [funding];
    album.funding = fundingArray.map(parseFunding).filter(Boolean) as Funding[];
  }

  // Publisher reference (if this album belongs to a publisher)
  const publisher = channel['podcast:publisher'];
  if (publisher) {
    album.publisher = parsePublisherReference(publisher);
  }

  // Some feeds point at their publisher with a bare channel-level
  // <podcast:remoteItem medium="publisher"> and no <podcast:publisher> wrapper.
  // That has to be *modelled*, not passed through as an unknown element: the
  // Download Catalog flows overwrite album.publisher unconditionally after
  // parsing, so a passed-through copy would be re-emitted alongside the
  // <podcast:publisher> block the generator writes — two publisher references
  // in a file we rewrote on the user's behalf. Podroll remoteItems (any other
  // medium) still round-trip untouched via unknownChannelElements.
  const channelRemoteItems = channel['podcast:remoteItem'];
  const remoteItemArray = channelRemoteItems
    ? (Array.isArray(channelRemoteItems) ? channelRemoteItems : [channelRemoteItems])
    : [];
  const podrollItems = remoteItemArray.filter(
    item => getAttr(item, 'medium') !== 'publisher'
  );
  if (podrollItems.length !== remoteItemArray.length && !album.publisher) {
    const publisherItem = remoteItemArray.find(
      item => getAttr(item, 'medium') === 'publisher'
    );
    const feedGuid = getAttr(publisherItem, 'feedGuid');
    const feedUrl = getAttr(publisherItem, 'feedUrl');
    if (feedGuid || feedUrl) {
      album.publisher = { feedGuid: feedGuid || '', feedUrl: feedUrl || undefined };
    }
  }

  // Artist Npub (from podcast:txt with purpose="npub")
  const txtTags = channel['podcast:txt'];
  if (txtTags) {
    const txtArray = Array.isArray(txtTags) ? txtTags : [txtTags];
    for (const txt of txtArray) {
      if (getAttr(txt, 'purpose') === 'npub') {
        album.artistNpub = getText(txt) || '';
        break;
      }
    }
  }

  // Capture unknown channel elements
  album.unknownChannelElements = captureUnknownElements(channel, ALBUM_CHANNEL_KEYS);

  // Keep only the podroll entries in the passthrough. Any publisher-medium one
  // was consumed into album.publisher just above, and the generator writes that
  // back out as a <podcast:publisher> block — leaving it here too would emit it
  // twice. Drop the key entirely when nothing but the publisher ref was there.
  if (album.unknownChannelElements?.['podcast:remoteItem']) {
    if (podrollItems.length > 0) {
      album.unknownChannelElements['podcast:remoteItem'] =
        podrollItems.length === 1 ? podrollItems[0] : podrollItems;
    } else {
      delete album.unknownChannelElements['podcast:remoteItem'];
      if (Object.keys(album.unknownChannelElements).length === 0) {
        album.unknownChannelElements = undefined;
      }
    }
  }

  // Tracks
  const items = channel.item;
  if (items) {
    const itemArray = Array.isArray(items) ? items : [items];
    album.tracks = itemArray.map((item, index) => parseTrack(item, index + 1, album.value, album.persons));
  }

  // Detect OP3 prefix on any track enclosure URLs
  const hasOp3 = album.tracks.some(t => OP3_PREFIX_RE.test(t.enclosureUrl));
  album.op3 = hasOp3;
  if (hasOp3) {
    for (const track of album.tracks) {
      if (OP3_PREFIX_RE.test(track.enclosureUrl)) {
        track.enclosureUrl = stripOp3Prefix(track.enclosureUrl);
      }
    }
  }

  return album;
};

// Helper to get text content
function getText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && node !== null) {
    if ('#text' in node) return String((node as Record<string, unknown>)['#text']);
  }
  return '';
}

// Helper to get attribute
function getAttr(node: unknown, attr: string): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'object' && node !== null) {
    const key = `@_${attr}`;
    if (key in node) return String((node as Record<string, unknown>)[key]);
  }
  return '';
}

// Read <atom:link rel="self" href="..."> — the URL a feed claims to live at.
// Not added to KNOWN_CHANNEL_KEYS on purpose: the element still round-trips
// through unknownChannelElements, this only reads it.
function parseSelfLink(channel: unknown): string {
  if (!channel || typeof channel !== 'object') return '';
  const raw = (channel as Record<string, unknown>)['atom:link'];
  if (!raw) return '';
  const links = Array.isArray(raw) ? raw : [raw];
  for (const link of links) {
    if (getAttr(link, 'rel') !== 'self') continue;
    const href = getAttr(link, 'href');
    if (href.startsWith('http')) return href;
  }
  return '';
}

// Parse all <podcast:image> elements under a channel or item node into PodcastImage[].
function parsePodcastImages(parent: unknown): PodcastImage[] {
  if (!parent || typeof parent !== 'object') return [];
  const raw = (parent as Record<string, unknown>)['podcast:image'];
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((node): PodcastImage => {
      const image: PodcastImage = { href: getAttr(node, 'href') };
      const purpose = getAttr(node, 'purpose');
      const alt = getAttr(node, 'alt');
      const aspectRatio = getAttr(node, 'aspect-ratio');
      const width = getAttr(node, 'width');
      const height = getAttr(node, 'height');
      const type = getAttr(node, 'type');
      if (purpose) image.purpose = purpose;
      if (alt) image.alt = alt;
      if (aspectRatio) image.aspectRatio = aspectRatio;
      if (width) image.width = parseInt(width) || undefined;
      if (height) image.height = parseInt(height) || undefined;
      if (type) image.type = type;
      return image;
    })
    .filter(img => img.href);
}

// Capture unknown elements from a parsed XML object
function captureUnknownElements(obj: Record<string, unknown>, knownKeys: Set<string>): Record<string, unknown> | undefined {
  const unknown: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    // Skip known keys and XML parser internals (attributes start with @_)
    if (knownKeys.has(key) || key.startsWith('@_')) {
      continue;
    }
    unknown[key] = obj[key];
  }

  // Return undefined if no unknown elements found
  return Object.keys(unknown).length > 0 ? unknown : undefined;
}

// Intermediate type for parsing a single person tag (has one role)
interface ParsedPersonTag {
  name: string;
  href?: string;
  img?: string;
  npub?: string;
  group: PersonGroup;
  role: string;
}

// Parse a single person tag from XML
function parsePersonTag(node: unknown): ParsedPersonTag | null {
  if (!node) return null;

  return {
    name: getText(node),
    href: getAttr(node, 'href') || undefined,
    img: getAttr(node, 'img') || undefined,
    npub: getAttr(node, 'npub') || undefined,
    group: (getAttr(node, 'group') || 'music') as PersonGroup,
    role: getAttr(node, 'role') || 'band'
  };
}

// Merge multiple person tags with the same name into a single Person with multiple roles
function mergePersonTags(tags: ParsedPersonTag[]): Person[] {
  const personMap = new Map<string, Person>();

  for (const tag of tags) {
    // Create a key based on name + href + img + npub to group same person
    const key = `${tag.name}|${tag.href || ''}|${tag.img || ''}|${tag.npub || ''}`;

    if (personMap.has(key)) {
      // Add role to existing person
      const person = personMap.get(key)!;
      const roleExists = person.roles.some(
        r => r.group === tag.group && r.role === tag.role
      );
      if (!roleExists) {
        person.roles.push({ group: tag.group, role: tag.role });
      }
    } else {
      // Create new person
      personMap.set(key, {
        name: tag.name,
        href: tag.href,
        img: tag.img,
        npub: tag.npub,
        roles: [{ group: tag.group, role: tag.role }]
      });
    }
  }

  return Array.from(personMap.values());
}

// Parse person tags and merge by name
function parsePersons(nodes: unknown): Person[] {
  if (!nodes) return [];
  const nodeArray = Array.isArray(nodes) ? nodes : [nodes];
  const tags = nodeArray.map(parsePersonTag).filter(Boolean) as ParsedPersonTag[];
  return mergePersonTags(tags);
}

// Parse funding tag
function parseFunding(node: unknown): Funding | null {
  if (!node) return null;
  const url = getAttr(node, 'url');
  if (!url) return null;

  return {
    url,
    text: getText(node) || ''
  };
}

// Parse value recipient
function parseRecipient(node: unknown): ValueRecipient | null {
  if (!node) return null;

  // Derive the type from the address rather than trusting the XML's `type`
  // attribute: older tools (e.g. the original musicsideproject.com) only knew
  // about Lightning nodes and wrote type="node" even for Lightning addresses.
  // An address containing "@" is always a Lightning address. This mirrors the
  // auto-detection the editor UI applies on manual edit (RecipientsList.tsx).
  const address = getAttr(node, 'address') || '';
  const split = parseInt(getAttr(node, 'split')) || 0;

  // Migrate the legacy MSP 1.0 support node to the MSP 2.0 lnaddress identity,
  // preserving the split so support payments keep flowing after import. Match
  // on the pubkey (unique, unforgeable) — not the name, which a user may rename.
  if (address.toLowerCase() === LEGACY_MSP_NODE_PUBKEY) {
    return {
      name: MSP_SUPPORT_RECIPIENT.name,
      address: MSP_SUPPORT_RECIPIENT.address,
      split,
      type: 'lnaddress'
    };
  }

  return {
    name: getAttr(node, 'name') || '',
    address,
    split,
    type: address ? detectAddressType(address) : 'node',
    customKey: getAttr(node, 'customKey') || undefined,
    customValue: getAttr(node, 'customValue') || undefined
  };
}

// Parse value block
function parseValueBlock(node: unknown): ValueBlock {
  const recipients = (node as Record<string, unknown>)?.['podcast:valueRecipient'];
  const recipientArray = recipients ? (Array.isArray(recipients) ? recipients : [recipients]) : [];

  return {
    type: 'lightning',
    method: 'keysend',
    suggested: getAttr(node, 'suggested') || undefined,
    recipients: recipientArray.map(parseRecipient).filter(Boolean) as ValueRecipient[]
  };
}

// Parse common channel elements shared between Album and PublisherFeed
function parseCommonChannelElements(channel: Record<string, unknown>): Omit<BaseChannelData, 'unknownChannelElements'> {
  // Basic info
  const title = getText(channel.title) || '';
  const author = getText(channel['itunes:author']) || '';
  const description = getText(channel.description) || '';
  const link = getText(channel.link) || '';
  const language = getText(channel.language) || 'en';
  const generator = getText(channel.generator) || 'MSP 2.0';
  const pubDate = getText(channel.pubDate) || new Date().toUTCString();
  const lastBuildDate = getText(channel.lastBuildDate) || new Date().toUTCString();

  // Podcast Index tags
  const podcastGuid = getText(channel['podcast:guid']) || '';

  // Locked
  const lockedNode = channel['podcast:locked'];
  const locked = lockedNode ? getText(lockedNode) === 'yes' : false;
  const lockedOwner = lockedNode ? getAttr(lockedNode, 'owner') || '' : '';

  // Categories
  const categoriesNode = channel['itunes:category'];
  let categories: string[] = [];
  if (categoriesNode) {
    const catArray = Array.isArray(categoriesNode) ? categoriesNode : [categoriesNode];
    categories = catArray.map(c => getAttr(c, 'text')).filter(Boolean) as string[];
  }

  // Keywords
  const keywords = getText(channel['itunes:keywords']) || '';

  // Explicit
  const explicitVal = channel['itunes:explicit'];
  const explicit = explicitVal === true || explicitVal === 'true' || getText(explicitVal) === 'true';

  // Owner
  const owner = channel['itunes:owner'];
  const ownerName = owner ? getText((owner as Record<string, unknown>)['itunes:name']) || '' : '';
  const ownerEmail = owner ? getText((owner as Record<string, unknown>)['itunes:email']) || '' : '';

  // Image
  const image = channel.image as Record<string, unknown> | undefined;
  let imageUrl = image ? getText(image.url) || '' : '';
  const imageTitle = image ? getText(image.title) || '' : '';
  const imageLink = image ? getText(image.link) || '' : '';
  const imageDescription = image ? getText(image.description) || '' : '';

  // iTunes image fallback
  const itunesImage = channel['itunes:image'];
  if (itunesImage && !imageUrl) {
    imageUrl = getAttr(itunesImage, 'href') || '';
  }

  // Contact
  const managingEditor = getText(channel.managingEditor) || '';
  const webMaster = getText(channel.webMaster) || '';

  // Persons
  const persons = parsePersons(channel['podcast:person']);

  // Value block
  const valueNode = channel['podcast:value'];
  const value: ValueBlock = valueNode
    ? parseValueBlock(valueNode)
    : { type: 'lightning', method: 'keysend', suggested: '0.000033333', recipients: [] };

  // Funding
  const fundingNode = channel['podcast:funding'];
  let funding: Funding[] = [];
  if (fundingNode) {
    const fundingArray = Array.isArray(fundingNode) ? fundingNode : [fundingNode];
    funding = fundingArray.map(parseFunding).filter(Boolean) as Funding[];
  }

  return {
    title,
    author,
    description,
    link,
    language,
    generator,
    pubDate,
    lastBuildDate,
    podcastGuid,
    locked,
    lockedOwner,
    categories,
    keywords,
    explicit,
    ownerName,
    ownerEmail,
    imageUrl,
    imageTitle,
    imageLink,
    imageDescription,
    podcastImages: parsePodcastImages(channel),
    managingEditor,
    webMaster,
    persons,
    value,
    funding
  };
}

// Parse remote item (for publisher feeds and podroll)
function parseRemoteItem(node: unknown): RemoteItem | null {
  if (!node) return null;

  const feedGuid = getAttr(node, 'feedGuid');
  const feedUrl = getAttr(node, 'feedUrl');

  // Must have at least feedGuid or feedUrl
  if (!feedGuid && !feedUrl) return null;

  return {
    feedGuid: feedGuid || '',
    feedUrl: feedUrl || undefined,
    itemGuid: getAttr(node, 'itemGuid') || undefined,
    medium: getAttr(node, 'medium') || undefined,
    // The spec defines title as an ATTRIBUTE and the element as self-closing.
    // Reading only the element text meant every conforming publisher feed —
    // Fountain's among them — imported with no titles at all. The text fallback
    // stays for feeds MSP itself wrote before the generator was corrected.
    title: getAttr(node, 'title') || getText(node) || undefined,
    image: getAttr(node, 'feedImg') || getAttr(node, 'image') || undefined
  };
}

/**
 * Parse a publisher reference (for albums that belong to a publisher).
 *
 * The spec form is a <podcast:publisher> wrapping exactly one
 * <podcast:remoteItem medium="publisher">, and that is what the generator emits.
 * Two malformed shapes also occur in the wild and both used to return undefined
 * — which silently *deleted* them, because 'podcast:publisher' is in
 * KNOWN_CHANNEL_KEYS and so is excluded from unknownChannelElements too. Since
 * the Download Feed flow is a parse→regenerate, that lost the tag outright.
 * Reading them here normalizes all three to the canonical form on output.
 */
function parsePublisherReference(node: unknown): PublisherReference | undefined {
  if (!node) return undefined;

  const publisherNode = node as Record<string, unknown>;
  const raw = publisherNode['podcast:remoteItem'];

  // fast-xml-parser returns an array when the child repeats, and getAttr returns
  // '' for an array — so more than one remoteItem used to drop the publisher
  // entirely. The spec allows exactly one; take the first usable entry.
  const candidates: unknown[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  // Attributes written directly on <podcast:publisher> with no child element.
  // Out of spec, but reading it beats discarding the user's data.
  candidates.push(publisherNode);

  for (const candidate of candidates) {
    const feedGuid = getAttr(candidate, 'feedGuid');
    const feedUrl = getAttr(candidate, 'feedUrl');
    if (feedGuid || feedUrl) {
      return {
        feedGuid: feedGuid || '',
        feedUrl: feedUrl || undefined
      };
    }
  }

  return undefined;
}

// Parse track/item
function parseTrack(node: unknown, trackNumber: number, albumValue: ValueBlock, albumPersons: Person[]): Track {
  const track = createEmptyTrack(trackNumber);
  const item = node as Record<string, unknown>;

  track.title = getText(item.title) || '';
  track.description = getText(item.description) || '';
  track.pubDate = getText(item.pubDate) || new Date().toUTCString();

  // GUID
  const guid = item.guid;
  if (guid) {
    track.guid = getText(guid) || crypto.randomUUID();
  }

  // Enclosure
  const enclosure = item.enclosure;
  if (enclosure) {
    track.enclosureUrl = getAttr(enclosure, 'url') || '';
    // Only keep a length that could plausibly be a real file. `0` and generator
    // placeholders (MSP itself long wrote a literal `33` for every track) are dropped
    // so the size gets re-measured from the host instead of propagating a wrong number.
    const length = parseInt(getAttr(enclosure, 'length') || '', 10);
    track.enclosureLength = Number.isFinite(length) && length >= MIN_PLAUSIBLE_MEDIA_BYTES ? String(length) : '';
    track.enclosureType = getAttr(enclosure, 'type') || 'audio/mpeg';
  }

  // Duration
  track.duration = getText(item['itunes:duration']) || '00:00:00';

  // Season number
  const season = item['podcast:season'];
  if (season) {
    track.season = parseInt(getText(season)) || undefined;
  }

  // Episode number
  const episode = item['podcast:episode'];
  if (episode) {
    const episodeNum = parseInt(getText(episode));
    track.episode = episodeNum || undefined;
    track.trackNumber = episodeNum || trackNumber;
  }

  // Explicit
  const trackExplicit = item['itunes:explicit'];
  track.explicit = trackExplicit === true || trackExplicit === 'true' || getText(trackExplicit) === 'true';

  // Track image (check itunes:image first, then podcast:images as fallback)
  const itunesImage = item['itunes:image'];
  if (itunesImage) {
    track.trackArtUrl = getAttr(itunesImage, 'href') || '';
  }
  // Check podcast:images for URL (if no itunes:image) and dimensions
  const podcastImages = item['podcast:images'];
  if (podcastImages) {
    // Fallback to podcast:images srcset for URL if no itunes:image
    if (!track.trackArtUrl) {
      const srcset = getAttr(podcastImages, 'srcset') || '';
      // srcset can be a single URL or multiple URLs with sizes - take the first one
      track.trackArtUrl = srcset.split(' ')[0] || '';
    }
    // Parse width and height attributes
    const width = getAttr(podcastImages, 'width');
    const height = getAttr(podcastImages, 'height');
    if (width) track.trackArtWidth = parseInt(width) || undefined;
    if (height) track.trackArtHeight = parseInt(height) || undefined;
  }

  // Podcasting 2.0 additional images
  track.podcastImages = parsePodcastImages(item);

  // Transcript
  const transcript = item['podcast:transcript'];
  if (transcript) {
    track.transcriptUrl = getAttr(transcript, 'url') || '';
    // Fallback only — a feed that states its own type keeps it verbatim.
    track.transcriptType = getAttr(transcript, 'type') || DEFAULT_TRANSCRIPT_TYPE;
  }

  // Persons - only set override if different from album
  const persons = item['podcast:person'];
  if (persons) {
    track.persons = parsePersons(persons);
    track.overridePersons = !arePersonsEqual(track.persons, albumPersons);
  }

  // Value block - only set override if different from album
  const value = item['podcast:value'];
  if (value) {
    track.value = parseValueBlock(value);
    track.overrideValue = !areValueBlocksStrictEqual(track.value, albumValue);
  }

  // Capture unknown item elements
  track.unknownItemElements = captureUnknownElements(item, KNOWN_ITEM_KEYS);

  return track;
}

// Check if URL is an MSP-hosted feed
const isMspUrl = (url: string): boolean => {
  return url.includes('/api/hosted/') ||
    url.includes('musicsideproject.com') ||
    url.includes('msp.podtards.com') ||
    url.includes('msp-2-0');
};

/** Carries the real reason a fetch failed, so callers can say something true. */
export class FeedFetchError extends Error {
  // Declared as fields rather than constructor parameter properties:
  // erasableSyntaxOnly is enabled in tsconfig.
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = 'FeedFetchError';
    this.code = code;
    this.status = status;
  }
}

const FETCH_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*';
const PASTE_HINT = ' You can also paste the XML content directly.';

/**
 * Mirrors the ErrorCode union in api/proxy-feed.ts. An unknown code falls back
 * to the server's own `error` string, so adding a code server-side degrades to a
 * usable message rather than a wrong one.
 */
const CODE_MESSAGES: Record<string, string> = {
  'not-found': "That URL didn't load — the host returned 404 Not Found.",
  blocked:
    'The host refused our request. Bot protection (on Cloudflare: Security → Bots) may be blocking it — Podcast Index would be blocked the same way.',
  'not-a-feed':
    "That URL loaded, but it isn't an RSS feed. Check you copied the feed URL rather than a web page.",
  'too-large':
    'That feed is too large to fetch through MSP. Download the XML and import it as a file instead.',
  'unsafe-address': 'That address is not one MSP can fetch. Use a public URL.',
  'invalid-url': "That doesn't look like a valid feed URL.",
  'rate-limited': "You've imported a lot of feeds recently. Wait a few minutes and try again.",
  timeout: "That URL didn't respond in time.",
  network: "Couldn't connect to that address.",
  'too-many-redirects': 'That URL redirects too many times.',
  'upstream-error': "That URL didn't load — the host returned an error."
};

const looksLikeFeed = (xml: string): boolean =>
  xml.includes('<rss') || xml.includes('<feed') || xml.includes('<channel');

/**
 * Optimisation only. Works when the host sends CORS headers; most self-hosted
 * feeds don't. Its failure is not evidence about the feed — a CORS rejection is
 * a bare TypeError — so it never produces the user-facing error.
 */
async function fetchDirect(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { Accept: FETCH_ACCEPT } });
    if (!response.ok) return null;
    const content = await response.text();
    return looksLikeFeed(content) ? content : null;
  } catch {
    return null;
  }
}

/** The authoritative attempt: throws a FeedFetchError carrying the real reason. */
async function fetchViaProxy(url: string): Promise<string> {
  let response: Response;
  try {
    response = await apiFetch(`/api/proxy-feed?url=${encodeURIComponent(url)}`, {
      headers: { Accept: FETCH_ACCEPT }
    });
  } catch {
    throw new FeedFetchError('Could not reach MSP to fetch that feed.' + PASTE_HINT, 'network');
  }

  if (response.ok) {
    const content = await response.text();
    if (looksLikeFeed(content)) return content;
    throw new FeedFetchError(CODE_MESSAGES['not-a-feed'] + PASTE_HINT, 'not-a-feed');
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: string; code?: string; status?: number }
    | null;
  const code = body?.code ?? 'upstream-error';
  const message = CODE_MESSAGES[code] ?? body?.error ?? CODE_MESSAGES['upstream-error'];
  throw new FeedFetchError(message + PASTE_HINT, code, body?.status ?? response.status);
}

/**
 * Fetch a feed's XML, going through /api/proxy-feed to sidestep CORS.
 *
 * Exactly one attempt is authoritative for the error. This used to loop over
 * four transports — direct, our proxy, allorigins.win and corsproxy.io —
 * `continue`-ing past every failure, so the only thing it could ever report was
 * a generic "paste the XML directly". The two public proxies are gone for three
 * independent reasons: they leak every user's feed URL to a third party,
 * corsproxy.io requires an API key so that entry always failed, and allorigins
 * wraps the body in JSON that was unwrapped heuristically, which could mangle a
 * feed. Our own proxy no longer has a domain allowlist, so they cover nothing.
 */
export const fetchFeedFromUrl = async (url: string): Promise<string> => {
  // MSP-hosted feeds go through the proxy first: on a preview deploy the app and
  // the canonical hosted URL are different origins, so direct always CORS-fails.
  if (isMspUrl(url)) return fetchViaProxy(url);

  return (await fetchDirect(url)) ?? (await fetchViaProxy(url));
};

// Detect if XML is a video feed based on medium tag
export const isVideoFeed = (xmlString: string): boolean => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true
  });

  try {
    const result = parser.parse(xmlString);
    const channel = result?.rss?.channel;
    if (!channel) return false;

    const medium = getText(channel['podcast:medium']);
    return medium === 'video';
  } catch {
    return false;
  }
};

// Detect if XML is a publisher feed based on medium tag
export const isPublisherFeed = (xmlString: string): boolean => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true
  });

  try {
    const result = parser.parse(xmlString);
    const channel = result?.rss?.channel;
    if (!channel) return false;

    const medium = getText(channel['podcast:medium']);
    return medium === 'publisher';
  } catch {
    return false;
  }
};

// Parse XML string to PublisherFeed object
export const parsePublisherRssFeed = (xmlString: string): PublisherFeed => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseAttributeValue: true,
    trimValues: true
  });

  const result = parser.parse(xmlString);
  const channel = result?.rss?.channel;

  if (!channel) {
    throw new Error('Invalid RSS feed: missing channel element');
  }

  // Parse common channel elements
  const common = parseCommonChannelElements(channel);

  // Create publisher feed with common elements (podcastImages comes via ...common)
  const feed: PublisherFeed = {
    ...common,
    medium: 'publisher',
    unknownChannelElements: captureUnknownElements(channel, KNOWN_CHANNEL_KEYS),
    remoteItems: []
  };

  // A feed imported from a file/paste has no import URL, so fall back to the URL
  // the feed claims for itself. Overridden by the real import URL in handleImport
  // when there is one.
  const selfLink = parseSelfLink(channel);
  if (selfLink) {
    feed.sourceUrl = selfLink;
  }

  // Remote items (the feeds this publisher owns)
  const remoteItems = channel['podcast:remoteItem'];
  if (remoteItems) {
    const remoteArray = Array.isArray(remoteItems) ? remoteItems : [remoteItems];
    feed.remoteItems = remoteArray.map(parseRemoteItem).filter(Boolean) as RemoteItem[];
  }

  return feed;
};
