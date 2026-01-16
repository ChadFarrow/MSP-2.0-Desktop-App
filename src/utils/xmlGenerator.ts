// MSP 2.0 - XML Generator for Demu RSS Feeds
import type { Album, Track, Person, ValueBlock, ValueRecipient, Funding, PublisherFeed, RemoteItem, PublisherReference } from '../types/feed';
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
    lines.push(`${indent(level + 1)}<podcast:images srcset="${escapeXml(artUrl)}" />`);
  }

  // Enclosure (audio file)
  const fileLength = track.enclosureLength || '0';
  lines.push(`${indent(level + 1)}<enclosure url="${escapeXml(track.enclosureUrl)}" length="${fileLength}" type="${track.enclosureType}"/>`);

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

  lines.push(`${indent(level)}</item>`);

  return lines.join('\n');
};

// Main function to generate complete RSS feed
export const generateRssFeed = (album: Album): string => {
  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // RSS root with namespaces
  lines.push('<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">');

  // Channel
  lines.push(`${indent(1)}<channel>`);

  // Title
  lines.push(`${indent(2)}<title>${escapeXml(album.title)}</title>`);

  // Author
  lines.push(`${indent(2)}<itunes:author>${escapeXml(album.author)}</itunes:author>`);

  // Description
  lines.push(`${indent(2)}<description>`);
  lines.push(`${indent(3)}${escapeXml(album.description)}`);
  lines.push(`${indent(2)}</description>`);

  // Link
  if (album.link) {
    lines.push(`${indent(2)}<link>${escapeXml(album.link)}</link>`);
  }

  // Language
  lines.push(`${indent(2)}<language>${album.language}</language>`);

  // Generator
  lines.push(`${indent(2)}<generator>${escapeXml(album.generator)}</generator>`);

  // Dates
  lines.push(`${indent(2)}<pubDate>${formatRFC822Date(album.pubDate)}</pubDate>`);
  lines.push(`${indent(2)}<lastBuildDate>${formatRFC822Date(album.lastBuildDate)}</lastBuildDate>`);

  // Locked
  if (album.locked && album.lockedOwner) {
    lines.push(`${indent(2)}<podcast:locked owner="${escapeXml(album.lockedOwner)}">yes</podcast:locked>`);
  }

  // GUID
  if (album.podcastGuid) {
    lines.push(`${indent(2)}<podcast:guid>${escapeXml(album.podcastGuid)}</podcast:guid>`);
  }

  // Categories
  album.categories.forEach(cat => {
    lines.push(`${indent(2)}<itunes:category text="${escapeXml(cat)}" />`);
  });

  // Keywords
  if (album.keywords) {
    lines.push(`${indent(2)}<itunes:keywords>${escapeXml(album.keywords)}</itunes:keywords>`);
  }

  // Location
  if (album.location) {
    lines.push(`${indent(2)}<podcast:location>${escapeXml(album.location)}</podcast:location>`);
  }

  // Contact
  if (album.managingEditor) {
    lines.push(`${indent(2)}<managingEditor>${escapeXml(album.managingEditor)}</managingEditor>`);
  }
  if (album.webMaster) {
    lines.push(`${indent(2)}<webMaster>${escapeXml(album.webMaster)}</webMaster>`);
  }

  // Image
  if (album.imageUrl) {
    lines.push(`${indent(2)}<image>`);
    lines.push(`${indent(3)}<url>${escapeXml(album.imageUrl)}</url>`);
    lines.push(`${indent(3)}<title>${escapeXml(album.imageTitle || album.title)}</title>`);
    if (album.imageDescription) {
      lines.push(`${indent(3)}<description>${escapeXml(album.imageDescription)}</description>`);
    }
    lines.push(`${indent(2)}</image>`);
  }

  // iTunes image
  if (album.imageUrl) {
    lines.push(`${indent(2)}<itunes:image href="${escapeXml(album.imageUrl)}" />`);
  }

  // Medium
  lines.push(`${indent(2)}<podcast:medium>${album.medium}</podcast:medium>`);

  // Explicit
  lines.push(`${indent(2)}<itunes:explicit>${album.explicit ? 'true' : 'false'}</itunes:explicit>`);

  // Owner
  if (album.ownerName || album.ownerEmail) {
    lines.push(`${indent(2)}<itunes:owner>`);
    if (album.ownerName) {
      lines.push(`${indent(3)}<itunes:name>${escapeXml(album.ownerName)}</itunes:name>`);
    }
    if (album.ownerEmail) {
      lines.push(`${indent(3)}<itunes:email>${escapeXml(album.ownerEmail)}</itunes:email>`);
    }
    lines.push(`${indent(2)}</itunes:owner>`);
  }

  // Persons
  album.persons.forEach(p => lines.push(generatePersonXml(p, 2)));

  // Value block
  if (album.value.recipients.length > 0) {
    lines.push(generateValueXml(album.value, 2));
  }

  // Funding
  (album.funding || []).forEach(f => {
    const fundingXml = generateFundingXml(f, 2);
    if (fundingXml) lines.push(fundingXml);
  });

  // Publisher reference (if this album belongs to a publisher)
  if (album.publisher) {
    const publisherXml = generatePublisherXml(album.publisher, 2);
    if (publisherXml) lines.push(publisherXml);
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

  // RSS root with namespaces
  lines.push('<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0">');

  // Channel
  lines.push(`${indent(1)}<channel>`);

  // Title
  lines.push(`${indent(2)}<title>${escapeXml(publisher.title)}</title>`);

  // Author
  lines.push(`${indent(2)}<itunes:author>${escapeXml(publisher.author)}</itunes:author>`);

  // Description
  lines.push(`${indent(2)}<description>`);
  lines.push(`${indent(3)}${escapeXml(publisher.description)}`);
  lines.push(`${indent(2)}</description>`);

  // Link
  if (publisher.link) {
    lines.push(`${indent(2)}<link>${escapeXml(publisher.link)}</link>`);
  }

  // Language
  lines.push(`${indent(2)}<language>${publisher.language}</language>`);

  // Generator
  lines.push(`${indent(2)}<generator>${escapeXml(publisher.generator)}</generator>`);

  // Dates
  lines.push(`${indent(2)}<pubDate>${formatRFC822Date(publisher.pubDate)}</pubDate>`);
  lines.push(`${indent(2)}<lastBuildDate>${formatRFC822Date(publisher.lastBuildDate)}</lastBuildDate>`);

  // Locked
  if (publisher.locked && publisher.lockedOwner) {
    lines.push(`${indent(2)}<podcast:locked owner="${escapeXml(publisher.lockedOwner)}">yes</podcast:locked>`);
  }

  // GUID
  if (publisher.podcastGuid) {
    lines.push(`${indent(2)}<podcast:guid>${escapeXml(publisher.podcastGuid)}</podcast:guid>`);
  }

  // Categories
  publisher.categories.forEach(cat => {
    lines.push(`${indent(2)}<itunes:category text="${escapeXml(cat)}" />`);
  });

  // Keywords
  if (publisher.keywords) {
    lines.push(`${indent(2)}<itunes:keywords>${escapeXml(publisher.keywords)}</itunes:keywords>`);
  }

  // Location
  if (publisher.location) {
    lines.push(`${indent(2)}<podcast:location>${escapeXml(publisher.location)}</podcast:location>`);
  }

  // Contact
  if (publisher.managingEditor) {
    lines.push(`${indent(2)}<managingEditor>${escapeXml(publisher.managingEditor)}</managingEditor>`);
  }
  if (publisher.webMaster) {
    lines.push(`${indent(2)}<webMaster>${escapeXml(publisher.webMaster)}</webMaster>`);
  }

  // Image
  if (publisher.imageUrl) {
    lines.push(`${indent(2)}<image>`);
    lines.push(`${indent(3)}<url>${escapeXml(publisher.imageUrl)}</url>`);
    lines.push(`${indent(3)}<title>${escapeXml(publisher.imageTitle || publisher.title)}</title>`);
    if (publisher.imageDescription) {
      lines.push(`${indent(3)}<description>${escapeXml(publisher.imageDescription)}</description>`);
    }
    lines.push(`${indent(2)}</image>`);
  }

  // iTunes image
  if (publisher.imageUrl) {
    lines.push(`${indent(2)}<itunes:image href="${escapeXml(publisher.imageUrl)}" />`);
  }

  // Medium - always "publisher" for publisher feeds
  lines.push(`${indent(2)}<podcast:medium>publisher</podcast:medium>`);

  // Explicit
  lines.push(`${indent(2)}<itunes:explicit>${publisher.explicit ? 'true' : 'false'}</itunes:explicit>`);

  // Owner
  if (publisher.ownerName || publisher.ownerEmail) {
    lines.push(`${indent(2)}<itunes:owner>`);
    if (publisher.ownerName) {
      lines.push(`${indent(3)}<itunes:name>${escapeXml(publisher.ownerName)}</itunes:name>`);
    }
    if (publisher.ownerEmail) {
      lines.push(`${indent(3)}<itunes:email>${escapeXml(publisher.ownerEmail)}</itunes:email>`);
    }
    lines.push(`${indent(2)}</itunes:owner>`);
  }

  // Persons
  publisher.persons.forEach(p => lines.push(generatePersonXml(p, 2)));

  // Value block
  if (publisher.value.recipients.length > 0) {
    lines.push(generateValueXml(publisher.value, 2));
  }

  // Funding
  (publisher.funding || []).forEach(f => {
    const fundingXml = generateFundingXml(f, 2);
    if (fundingXml) lines.push(fundingXml);
  });

  // Remote items - the feeds this publisher owns (wrapped in podroll-style listing)
  if (publisher.remoteItems.length > 0) {
    publisher.remoteItems.forEach(item => {
      lines.push(generateRemoteItemXml(item, 2));
    });
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
