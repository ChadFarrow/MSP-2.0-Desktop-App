// MSP 2.0 - XML Parser for importing Demu RSS Feeds
import { XMLParser } from 'fast-xml-parser';
import type { Album, Track, Person, PersonRole, PersonGroup, ValueRecipient, ValueBlock, Funding } from '../types/feed';
import { createEmptyAlbum, createEmptyTrack } from '../types/feed';
import { areValueBlocksStrictEqual, arePersonsEqual } from './comparison';

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

  const album = createEmptyAlbum();

  // Basic info
  album.title = getText(channel.title) || '';
  album.author = getText(channel['itunes:author']) || '';
  album.description = getText(channel.description) || '';
  album.link = getText(channel.link) || '';
  album.language = getText(channel.language) || 'en';
  album.generator = getText(channel.generator) || 'MSP 2.0';
  album.pubDate = getText(channel.pubDate) || new Date().toUTCString();
  album.lastBuildDate = getText(channel.lastBuildDate) || new Date().toUTCString();

  // Podcast Index tags
  album.podcastGuid = getText(channel['podcast:guid']) || '';
  album.medium = (getText(channel['podcast:medium']) as 'music' | 'musicL') || 'music';
  album.location = getText(channel['podcast:location']) || '';

  // Locked
  const locked = channel['podcast:locked'];
  if (locked) {
    album.locked = getText(locked) === 'yes';
    album.lockedOwner = getAttr(locked, 'owner') || '';
  }

  // Categories
  const categories = channel['itunes:category'];
  if (categories) {
    const catArray = Array.isArray(categories) ? categories : [categories];
    album.categories = catArray.map(c => getAttr(c, 'text')).filter(Boolean) as string[];
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
  // Fallback to podcast:images if no itunes:image
  if (!track.trackArtUrl) {
    const podcastImages = item['podcast:images'];
    if (podcastImages) {
      // podcast:images uses srcset attribute
      const srcset = getAttr(podcastImages, 'srcset') || '';
      // srcset can be a single URL or multiple URLs with sizes - take the first one
      track.trackArtUrl = srcset.split(' ')[0] || '';
    }
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

  return track;
}

// Fetch XML from URL (with CORS proxy fallback)
export const fetchFeedFromUrl = async (url: string): Promise<string> => {
  const corsProxies = [
    '', // Try direct first
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
