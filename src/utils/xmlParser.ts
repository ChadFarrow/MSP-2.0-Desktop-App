// MSP 2.0 - XML Parser for importing Demu RSS Feeds
import { XMLParser } from 'fast-xml-parser';
import type { Album, Track, Person, PersonGroup, ValueRecipient, ValueBlock, Funding, PublisherFeed, RemoteItem, PublisherReference, BaseChannelData } from '../types/feed';
import { createEmptyTrack } from '../types/feed';
import { areValueBlocksStrictEqual, arePersonsEqual } from './comparison';

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
  'podcast:location',
  'podcast:locked',
  'podcast:person',
  'podcast:value',
  'podcast:funding',
  'podcast:publisher',
  'podcast:remoteItem'  // For publisher feeds
]);

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
    unknownChannelElements: captureUnknownElements(channel, KNOWN_CHANNEL_KEYS),
    tracks: []
  };

  // Podcast Index tags
  album.podcastGuid = getText(channel['podcast:guid']) || '';
  album.medium = (getText(channel['podcast:medium']) as 'music' | 'video') || 'music';
  album.location = getText(channel['podcast:location']) || '';

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

  // Capture unknown channel elements
  album.unknownChannelElements = captureUnknownElements(channel, KNOWN_CHANNEL_KEYS);

  // Tracks
  const items = channel.item;
  if (items) {
    const itemArray = Array.isArray(items) ? items : [items];
    album.tracks = itemArray.map((item, index) => parseTrack(item, index + 1, album.value, album.persons));
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
    group: (getAttr(node, 'group') || 'music') as PersonGroup,
    role: getAttr(node, 'role') || 'band'
  };
}

// Merge multiple person tags with the same name into a single Person with multiple roles
function mergePersonTags(tags: ParsedPersonTag[]): Person[] {
  const personMap = new Map<string, Person>();

  for (const tag of tags) {
    // Create a key based on name + href + img to group same person
    const key = `${tag.name}|${tag.href || ''}|${tag.img || ''}`;

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

  return {
    name: getAttr(node, 'name') || '',
    address: getAttr(node, 'address') || '',
    split: parseInt(getAttr(node, 'split')) || 0,
    type: (getAttr(node, 'type') || 'node') as 'node' | 'lnaddress',
    fee: getAttr(node, 'fee') === 'true',
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
  const location = getText(channel['podcast:location']) || '';

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
    location,
    categories,
    keywords,
    explicit,
    ownerName,
    ownerEmail,
    imageUrl,
    imageTitle,
    imageLink,
    imageDescription,
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
    title: getText(node) || undefined,
    image: getAttr(node, 'feedImg') || getAttr(node, 'image') || undefined
  };
}

// Parse publisher reference (for albums that belong to a publisher)
function parsePublisherReference(node: unknown): PublisherReference | undefined {
  if (!node) return undefined;

  const publisherNode = node as Record<string, unknown>;
  const remoteItem = publisherNode['podcast:remoteItem'];

  if (remoteItem) {
    const feedGuid = getAttr(remoteItem, 'feedGuid');
    const feedUrl = getAttr(remoteItem, 'feedUrl');

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
    const length = getAttr(enclosure, 'length');
    track.enclosureLength = (length && length !== '0') ? length : '';
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

  // Transcript
  const transcript = item['podcast:transcript'];
  if (transcript) {
    track.transcriptUrl = getAttr(transcript, 'url') || '';
    track.transcriptType = getAttr(transcript, 'type') || 'application/srt';
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
    url.includes('msp.podtards.com') ||
    url.includes('msp-2-0');
};

// Fetch XML from URL (with CORS proxy fallback)
export const fetchFeedFromUrl = async (url: string): Promise<string> => {
  // For MSP feeds, try our own proxy first to avoid CORS issues
  if (isMspUrl(url)) {
    try {
      const proxyUrl = `/api/proxy-feed?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });

      if (response.ok) {
        const content = await response.text();
        if (content.includes('<rss') || content.includes('<channel')) {
          return content;
        }
      }
    } catch {
      // Fall through to other methods
    }
  }

  const corsProxies = [
    '', // Try direct first
    '/api/proxy-feed?url=', // Our own proxy
    'https://api.allorigins.win/get?url=',
    'https://corsproxy.io/?'
  ];

  for (const proxy of corsProxies) {
    try {
      const fetchUrl = proxy
        ? `${proxy}${encodeURIComponent(url)}`
        : url;

      const response = await fetch(fetchUrl, {
        headers: {
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        }
      });

      if (!response.ok) continue;

      let content = await response.text();

      // Handle allorigins wrapper
      if (proxy.includes('allorigins.win')) {
        try {
          const data = JSON.parse(content);
          content = data.contents || content;
        } catch {
          // Not JSON, use as-is
        }
      }

      // Validate it's XML
      if (content.includes('<rss') || content.includes('<channel')) {
        return content;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Failed to fetch feed from URL. Please paste the XML content directly.');
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

  // Create publisher feed with common elements
  const feed: PublisherFeed = {
    ...common,
    medium: 'publisher',
    unknownChannelElements: captureUnknownElements(channel, KNOWN_CHANNEL_KEYS),
    remoteItems: []
  };

  // Remote items (the feeds this publisher owns)
  const remoteItems = channel['podcast:remoteItem'];
  if (remoteItems) {
    const remoteArray = Array.isArray(remoteItems) ? remoteItems : [remoteItems];
    feed.remoteItems = remoteArray.map(parseRemoteItem).filter(Boolean) as RemoteItem[];
  }

  return feed;
};
