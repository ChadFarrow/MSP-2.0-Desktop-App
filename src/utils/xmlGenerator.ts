// MSP 2.0 - XML Generator for Demu RSS Feeds
import type { Album, Track, Person, ValueBlock, ValueRecipient, Funding, PublisherFeed, RemoteItem, PublisherReference, BaseChannelData, AlternateEnclosure } from '../types/feed';
import { formatRFC822Date } from './dateUtils';

// Re-export for backward compatibility
export { formatRFC822Date };

// Escape XML special characters
const escapeXml = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

// Generate indent
const indent = (level: number): string => '    '.repeat(level);

// Common namespace declarations for RSS extensions
const NAMESPACE_URIS: Record<string, string> = {
  'content': 'http://purl.org/rss/1.0/modules/content/',
  'dc': 'http://purl.org/dc/elements/1.1/',
  'atom': 'http://www.w3.org/2005/Atom',
  'media': 'http://search.yahoo.com/mrss/',
  'sy': 'http://purl.org/rss/1.0/modules/syndication/',
  'slash': 'http://purl.org/rss/1.0/modules/slash/',
  'rawvoice': 'http://www.rawvoice.com/rawvoiceRssModule/',
  'googleplay': 'http://www.google.com/schemas/play-podcasts/1.0',
  'spotify': 'http://www.spotify.com/ns/rss',
  'psc': 'http://podlove.org/simple-chapters',
  'wfw': 'http://wellformedweb.org/CommentAPI/',
  'cc': 'http://creativecommons.org/ns#'
};

// Collect namespace prefixes from unknown elements recursively
const collectNamespacePrefixes = (obj: unknown, prefixes: Set<string>): void => {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectNamespacePrefixes(item, prefixes);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    // Check if key has a namespace prefix (e.g., "content:encoded")
    const colonIndex = key.indexOf(':');
    if (colonIndex > 0 && !key.startsWith('@_')) {
      const prefix = key.slice(0, colonIndex);
      // Only add if it's not already a known namespace (podcast, itunes)
      if (prefix !== 'podcast' && prefix !== 'itunes') {
        prefixes.add(prefix);
      }
    }
    // Recurse into nested objects
    collectNamespacePrefixes(record[key], prefixes);
  }
};

// Collect all namespaces needed for unknown elements in an album
const collectAlbumNamespaces = (album: { unknownChannelElements?: Record<string, unknown>; tracks: { unknownItemElements?: Record<string, unknown> }[] }): Set<string> => {
  const prefixes = new Set<string>();

  if (album.unknownChannelElements) {
    collectNamespacePrefixes(album.unknownChannelElements, prefixes);
  }

  for (const track of album.tracks) {
    if (track.unknownItemElements) {
      collectNamespacePrefixes(track.unknownItemElements, prefixes);
    }
  }

  return prefixes;
};

// Generate xmlns declarations for additional namespaces
const generateNamespaceDeclarations = (prefixes: Set<string>): string => {
  const declarations: string[] = [];
  for (const prefix of prefixes) {
    const uri = NAMESPACE_URIS[prefix];
    if (uri) {
      declarations.push(`xmlns:${prefix}="${uri}"`);
    }
  }
  return declarations.join(' ');
};

// Convert parsed XML object back to XML string (for unknown/unsupported elements)
const generateUnknownXml = (elements: Record<string, unknown>, level: number): string => {
  const lines: string[] = [];

  for (const [tagName, value] of Object.entries(elements)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      // Multiple elements with same tag name
      for (const item of value) {
        lines.push(generateSingleElementXml(tagName, item, level));
      }
    } else {
      lines.push(generateSingleElementXml(tagName, value, level));
    }
  }

  return lines.join('\n');
};

// Generate XML for a single element (handles attributes, text content, and nested elements)
const generateSingleElementXml = (tagName: string, value: unknown, level: number): string => {
  if (value === null || value === undefined) return '';

  // Simple text value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${indent(level)}<${tagName}>${escapeXml(String(value))}</${tagName}>`;
  }

  // Object with potential attributes and nested content
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const attrs: string[] = [];
    const children: string[] = [];
    let textContent = '';

    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('@_')) {
        // Attribute
        const attrName = key.slice(2);
        attrs.push(`${attrName}="${escapeXml(String(val))}"`);
      } else if (key === '#text') {
        // Text content
        textContent = String(val);
      } else if (val !== null && val !== undefined) {
        // Nested element
        if (Array.isArray(val)) {
          for (const item of val) {
            children.push(generateSingleElementXml(key, item, level + 1));
          }
        } else {
          children.push(generateSingleElementXml(key, val, level + 1));
        }
      }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    if (children.length === 0 && !textContent) {
      // Self-closing tag
      return `${indent(level)}<${tagName}${attrStr} />`;
    } else if (children.length === 0) {
      // Tag with text content only
      return `${indent(level)}<${tagName}${attrStr}>${escapeXml(textContent)}</${tagName}>`;
    } else {
      // Tag with nested elements
      const lines: string[] = [];
      lines.push(`${indent(level)}<${tagName}${attrStr}>`);
      if (textContent) {
        lines.push(`${indent(level + 1)}${escapeXml(textContent)}`);
      }
      lines.push(...children);
      lines.push(`${indent(level)}</${tagName}>`);
      return lines.join('\n');
    }
  }

  return '';
};

// Generate person XML - outputs one <podcast:person> tag per role
const generatePersonXml = (person: Person, level: number): string => {
  // Generate one tag per role (per Podcasting 2.0 spec)
  return person.roles.map(role => {
    const attrs: string[] = [];
    if (person.href) attrs.push(`href="${escapeXml(person.href)}"`);
    if (person.img) attrs.push(`img="${escapeXml(person.img)}"`);
    attrs.push(`group="${escapeXml(role.group)}"`);
    attrs.push(`role="${escapeXml(role.role)}"`);
    return `${indent(level)}<podcast:person ${attrs.join(' ')}>${escapeXml(person.name)}</podcast:person>`;
  }).join('\n');
};

// Generate value recipient XML
const generateRecipientXml = (recipient: ValueRecipient, level: number): string => {
  const attrs = [
    `name="${escapeXml(recipient.name)}"`,
    `address="${escapeXml(recipient.address)}"`,
    `split="${recipient.split}"`,
    `type="${recipient.type}"`
  ];
  if (recipient.fee) attrs.push('fee="true"');
  if (recipient.customKey) attrs.push(`customKey="${escapeXml(recipient.customKey)}"`);
  if (recipient.customValue) attrs.push(`customValue="${escapeXml(recipient.customValue)}"`);

  return `${indent(level)}<podcast:valueRecipient ${attrs.join(' ')} />`;
};

// Generate value block XML
const generateValueXml = (value: ValueBlock, level: number): string => {
  if (!value.recipients.length) return '';

  // Determine method based on recipient types
  // If any recipient uses lnaddress, method should be lnaddress
  const hasLnAddress = value.recipients.some(r => r.type === 'lnaddress');
  const method = hasLnAddress ? 'lnaddress' : 'keysend';

  const lines: string[] = [];
  const attrs = [
    `type="${value.type}"`,
    `method="${method}"`
  ];
  if (value.suggested) attrs.push(`suggested="${value.suggested}"`);

  lines.push(`${indent(level)}<podcast:value ${attrs.join(' ')}>`);
  value.recipients.forEach(r => lines.push(generateRecipientXml(r, level + 1)));
  lines.push(`${indent(level)}</podcast:value>`);

  return lines.join('\n');
};

// Generate funding XML
const generateFundingXml = (funding: Funding, level: number): string => {
  if (!funding.url) return '';
  return `${indent(level)}<podcast:funding url="${escapeXml(funding.url)}">${escapeXml(funding.text)}</podcast:funding>`;
};

// Generate remote item XML (for publisher feeds and podroll)
const generateRemoteItemXml = (item: RemoteItem, level: number): string => {
  const attrs: string[] = [];
  if (item.feedGuid) attrs.push(`feedGuid="${escapeXml(item.feedGuid)}"`);
  if (item.feedUrl) attrs.push(`feedUrl="${escapeXml(item.feedUrl)}"`);
  if (item.itemGuid) attrs.push(`itemGuid="${escapeXml(item.itemGuid)}"`);
  if (item.medium) attrs.push(`medium="${escapeXml(item.medium)}"`);
  if (item.image) attrs.push(`feedImg="${escapeXml(item.image)}"`);

  if (item.title) {
    return `${indent(level)}<podcast:remoteItem ${attrs.join(' ')}>${escapeXml(item.title)}</podcast:remoteItem>`;
  }
  return `${indent(level)}<podcast:remoteItem ${attrs.join(' ')} />`;
};

// Generate publisher reference XML (for albums that reference their publisher)
const generatePublisherXml = (publisher: PublisherReference, level: number): string => {
  if (!publisher.feedGuid && !publisher.feedUrl) return '';

  const lines: string[] = [];
  lines.push(`${indent(level)}<podcast:publisher>`);

  const attrs: string[] = [`medium="publisher"`];
  if (publisher.feedGuid) attrs.push(`feedGuid="${escapeXml(publisher.feedGuid)}"`);
  if (publisher.feedUrl) attrs.push(`feedUrl="${escapeXml(publisher.feedUrl)}"`);

  lines.push(`${indent(level + 1)}<podcast:remoteItem ${attrs.join(' ')} />`);
  lines.push(`${indent(level)}</podcast:publisher>`);

  return lines.join('\n');
};

// Generate alternate enclosure XML (podcast:alternateEnclosure)
const generateAlternateEnclosureXml = (enclosure: AlternateEnclosure, level: number): string => {
  // Must have at least one source with a URI
  if (!enclosure.sources || enclosure.sources.length === 0 || !enclosure.sources[0]?.uri) {
    return '';
  }

  const lines: string[] = [];

  // Build attributes - type is required
  const attrs: string[] = [`type="${escapeXml(enclosure.type)}"`];
  if (enclosure.length) attrs.push(`length="${escapeXml(enclosure.length)}"`);
  if (enclosure.bitrate) attrs.push(`bitrate="${escapeXml(enclosure.bitrate)}"`);
  if (enclosure.height) attrs.push(`height="${escapeXml(enclosure.height)}"`);
  if (enclosure.lang) attrs.push(`lang="${escapeXml(enclosure.lang)}"`);
  if (enclosure.title) attrs.push(`title="${escapeXml(enclosure.title)}"`);
  if (enclosure.rel) attrs.push(`rel="${escapeXml(enclosure.rel)}"`);
  if (enclosure.codecs) attrs.push(`codecs="${escapeXml(enclosure.codecs)}"`);
  if (enclosure.default) attrs.push('default="true"');

  lines.push(`${indent(level)}<podcast:alternateEnclosure ${attrs.join(' ')}>`);

  // Add sources
  for (const source of enclosure.sources) {
    if (source.uri) {
      const sourceAttrs: string[] = [`uri="${escapeXml(source.uri)}"`];
      if (source.contentType) sourceAttrs.push(`contentType="${escapeXml(source.contentType)}"`);
      lines.push(`${indent(level + 1)}<podcast:source ${sourceAttrs.join(' ')} />`);
    }
  }

  // Add integrity if present
  if (enclosure.integrity?.value) {
    lines.push(`${indent(level + 1)}<podcast:integrity type="${enclosure.integrity.type}" value="${escapeXml(enclosure.integrity.value)}" />`);
  }

  lines.push(`${indent(level)}</podcast:alternateEnclosure>`);

  return lines.join('\n');
};

// Generate common channel elements shared between Album and PublisherFeed
const generateCommonChannelElements = (data: BaseChannelData, medium: string, level: number): string[] => {
  const lines: string[] = [];

  // Title
  lines.push(`${indent(level)}<title>${escapeXml(data.title)}</title>`);

  // Author
  lines.push(`${indent(level)}<itunes:author>${escapeXml(data.author)}</itunes:author>`);

  // Description
  lines.push(`${indent(level)}<description>`);
  lines.push(`${indent(level + 1)}${escapeXml(data.description)}`);
  lines.push(`${indent(level)}</description>`);

  // Link
  if (data.link) {
    lines.push(`${indent(level)}<link>${escapeXml(data.link)}</link>`);
  }

  // Language
  lines.push(`${indent(level)}<language>${data.language}</language>`);

  // Generator - always use MSP 2.0 since we're generating the feed
  lines.push(`${indent(level)}<generator>MSP 2.0 - Music Side Project Studio</generator>`);

  // Dates
  lines.push(`${indent(level)}<pubDate>${formatRFC822Date(data.pubDate)}</pubDate>`);
  lines.push(`${indent(level)}<lastBuildDate>${formatRFC822Date(data.lastBuildDate)}</lastBuildDate>`);

  // Locked
  if (data.locked && data.lockedOwner) {
    lines.push(`${indent(level)}<podcast:locked owner="${escapeXml(data.lockedOwner)}">yes</podcast:locked>`);
  }

  // GUID
  if (data.podcastGuid) {
    lines.push(`${indent(level)}<podcast:guid>${escapeXml(data.podcastGuid)}</podcast:guid>`);
  }

  // Categories (default to Music for music feeds)
  const categories = data.categories.length > 0 ? data.categories : ['Music'];
  categories.forEach(cat => {
    lines.push(`${indent(level)}<itunes:category text="${escapeXml(cat)}" />`);
  });

  // Keywords
  if (data.keywords) {
    lines.push(`${indent(level)}<itunes:keywords>${escapeXml(data.keywords)}</itunes:keywords>`);
  }

  // Location
  if (data.location) {
    lines.push(`${indent(level)}<podcast:location>${escapeXml(data.location)}</podcast:location>`);
  }

  // Contact
  if (data.managingEditor) {
    lines.push(`${indent(level)}<managingEditor>${escapeXml(data.managingEditor)}</managingEditor>`);
  }
  if (data.webMaster) {
    lines.push(`${indent(level)}<webMaster>${escapeXml(data.webMaster)}</webMaster>`);
  }

  // Image
  if (data.imageUrl) {
    lines.push(`${indent(level)}<image>`);
    lines.push(`${indent(level + 1)}<url>${escapeXml(data.imageUrl)}</url>`);
    lines.push(`${indent(level + 1)}<title>${escapeXml(data.imageTitle || data.title)}</title>`);
    if (data.imageLink) {
      lines.push(`${indent(level + 1)}<link>${escapeXml(data.imageLink)}</link>`);
    }
    if (data.imageDescription) {
      lines.push(`${indent(level + 1)}<description>${escapeXml(data.imageDescription)}</description>`);
    }
    lines.push(`${indent(level)}</image>`);
  }

  // iTunes image
  if (data.imageUrl) {
    lines.push(`${indent(level)}<itunes:image href="${escapeXml(data.imageUrl)}" />`);
  }

  // Medium
  lines.push(`${indent(level)}<podcast:medium>${medium}</podcast:medium>`);

  // Explicit
  lines.push(`${indent(level)}<itunes:explicit>${data.explicit ? 'true' : 'false'}</itunes:explicit>`);

  // Owner
  if (data.ownerName || data.ownerEmail) {
    lines.push(`${indent(level)}<itunes:owner>`);
    if (data.ownerName) {
      lines.push(`${indent(level + 1)}<itunes:name>${escapeXml(data.ownerName)}</itunes:name>`);
    }
    if (data.ownerEmail) {
      lines.push(`${indent(level + 1)}<itunes:email>${escapeXml(data.ownerEmail)}</itunes:email>`);
    }
    lines.push(`${indent(level)}</itunes:owner>`);
  }

  // Persons
  data.persons.forEach(p => lines.push(generatePersonXml(p, level)));

  // Value block
  if (data.value.recipients.length > 0) {
    lines.push(generateValueXml(data.value, level));
  }

  // Funding
  (data.funding || []).forEach(f => {
    const fundingXml = generateFundingXml(f, level);
    if (fundingXml) lines.push(fundingXml);
  });

  return lines;
};

// Generate track/item XML
const generateTrackXml = (track: Track, album: Album, level: number): string => {
  const lines: string[] = [];

  lines.push(`${indent(level)}<item>`);
  lines.push(`${indent(level + 1)}<title>${escapeXml(track.title)}</title>`);

  if (track.description) {
    lines.push(`${indent(level + 1)}<description>${escapeXml(track.description)}</description>`);
  }

  lines.push(`${indent(level + 1)}<pubDate>${formatRFC822Date(track.pubDate)}</pubDate>`);
  lines.push(`${indent(level + 1)}<guid isPermaLink="false">${escapeXml(track.guid)}</guid>`);

  if (track.transcriptUrl) {
    lines.push(`${indent(level + 1)}<podcast:transcript url="${escapeXml(track.transcriptUrl)}" type="${track.transcriptType || 'application/srt'}" />`);
  }

  // Track artwork (falls back to album)
  const artUrl = track.trackArtUrl || album.imageUrl;
  if (artUrl) {
    lines.push(`${indent(level + 1)}<itunes:image href="${escapeXml(artUrl)}" />`);
    // Add podcast:images for better Podcast 2.0 app compatibility
    const imageAttrs = [`srcset="${escapeXml(artUrl)}"`];
    if (track.trackArtWidth) imageAttrs.push(`width="${track.trackArtWidth}"`);
    if (track.trackArtHeight) imageAttrs.push(`height="${track.trackArtHeight}"`);
    lines.push(`${indent(level + 1)}<podcast:images ${imageAttrs.join(' ')} />`);
  }

  // Enclosure (audio file)
  const fileLength = track.enclosureLength || '0';
  lines.push(`${indent(level + 1)}<enclosure url="${escapeXml(track.enclosureUrl)}" length="${fileLength}" type="${track.enclosureType}"/>`);

  // Alternate enclosures (e.g., music video for audio track)
  if (track.alternateEnclosures && track.alternateEnclosures.length > 0) {
    for (const altEnc of track.alternateEnclosures) {
      const altEncXml = generateAlternateEnclosureXml(altEnc, level + 1);
      if (altEncXml) lines.push(altEncXml);
    }
  }

  // Duration
  lines.push(`${indent(level + 1)}<itunes:duration>${track.duration}</itunes:duration>`);

  // Season (always 1)
  lines.push(`${indent(level + 1)}<podcast:season>1</podcast:season>`);

  // Episode number (use track.episode if set, otherwise trackNumber)
  lines.push(`${indent(level + 1)}<podcast:episode>${track.episode ?? track.trackNumber}</podcast:episode>`);

  // Explicit
  lines.push(`${indent(level + 1)}<itunes:explicit>${track.explicit ? 'true' : 'false'}</itunes:explicit>`);

  // Persons (override or inherit from album)
  const persons = track.overridePersons ? track.persons : album.persons;
  persons.forEach(p => lines.push(generatePersonXml(p, level + 1)));

  // Value block (override or inherit from album)
  const value = track.overrideValue && track.value ? track.value : album.value;
  if (value.recipients.length > 0) {
    lines.push(generateValueXml(value, level + 1));
  }

  // Unknown/unsupported item elements (preserved from import)
  if (track.unknownItemElements) {
    const unknownXml = generateUnknownXml(track.unknownItemElements, level + 1);
    if (unknownXml) lines.push(unknownXml);
  }

  lines.push(`${indent(level)}</item>`);

  return lines.join('\n');
};

// Main function to generate complete RSS feed
export const generateRssFeed = (album: Album): string => {
  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // Collect additional namespaces needed for unknown elements
  const additionalNamespaces = collectAlbumNamespaces(album);
  const additionalNsDecl = generateNamespaceDeclarations(additionalNamespaces);

  // RSS root with namespaces
  const baseNs = 'xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"';
  const rssAttrs = additionalNsDecl ? `${baseNs} ${additionalNsDecl}` : baseNs;
  lines.push(`<rss ${rssAttrs} version="2.0">`);

  // Channel
  lines.push(`${indent(1)}<channel>`);

  // Common channel elements
  lines.push(...generateCommonChannelElements(album, album.medium, 2));

  // Publisher reference (if this album belongs to a publisher)
  if (album.publisher) {
    const publisherXml = generatePublisherXml(album.publisher, 2);
    if (publisherXml) lines.push(publisherXml);
  }

  // Unknown/unsupported channel elements (preserved from import)
  if (album.unknownChannelElements) {
    const unknownXml = generateUnknownXml(album.unknownChannelElements, 2);
    if (unknownXml) lines.push(unknownXml);
  }

  // Tracks
  album.tracks.forEach(track => lines.push(generateTrackXml(track, album, 2)));

  // Close channel and rss
  lines.push(`${indent(1)}</channel>`);
  lines.push('</rss>');

  return lines.join('\n');
};

// Main function to generate complete Publisher RSS feed
export const generatePublisherRssFeed = (publisher: PublisherFeed): string => {
  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // Collect additional namespaces needed for unknown elements
  const prefixes = new Set<string>();
  if (publisher.unknownChannelElements) {
    collectNamespacePrefixes(publisher.unknownChannelElements, prefixes);
  }
  const additionalNsDecl = generateNamespaceDeclarations(prefixes);

  // RSS root with namespaces
  const baseNs = 'xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"';
  const rssAttrs = additionalNsDecl ? `${baseNs} ${additionalNsDecl}` : baseNs;
  lines.push(`<rss ${rssAttrs} version="2.0">`);

  // Channel
  lines.push(`${indent(1)}<channel>`);

  // Common channel elements (medium is always "publisher" for publisher feeds)
  lines.push(...generateCommonChannelElements(publisher, 'publisher', 2));

  // Remote items - the feeds this publisher owns
  if (publisher.remoteItems.length > 0) {
    publisher.remoteItems.forEach(item => {
      lines.push(generateRemoteItemXml(item, 2));
    });
  }

  // Unknown/unsupported channel elements (preserved from import)
  if (publisher.unknownChannelElements) {
    const unknownXml = generateUnknownXml(publisher.unknownChannelElements, 2);
    if (unknownXml) lines.push(unknownXml);
  }

  // Close channel and rss
  lines.push(`${indent(1)}</channel>`);
  lines.push('</rss>');

  return lines.join('\n');
};

// Download XML as file
export const downloadXml = (xml: string, filename: string = 'feed.xml'): void => {
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Copy XML to clipboard
export const copyToClipboard = async (xml: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(xml);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
};
