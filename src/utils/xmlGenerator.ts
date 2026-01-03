// MSP 2.0 - XML Generator for Demu RSS Feeds
import type { Album, Track, Person, ValueBlock, ValueRecipient, Funding } from '../types/feed';

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

// Format date to RFC-822
export const formatRFC822Date = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toUTCString();
};

// Generate indent
const indent = (level: number): string => '    '.repeat(level);

// Generate person XML
const generatePersonXml = (person: Person, level: number): string => {
  const attrs: string[] = [];
  if (person.href) attrs.push(`href="${escapeXml(person.href)}"`);
  if (person.img) attrs.push(`img="${escapeXml(person.img)}"`);
  attrs.push(`group="${escapeXml(person.group)}"`);
  attrs.push(`role="${escapeXml(person.role)}"`);

  return `${indent(level)}<podcast:person ${attrs.join(' ')}>${escapeXml(person.name)}</podcast:person>`;
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

  // Track number
  lines.push(`${indent(level + 1)}<podcast:episode>${track.trackNumber}</podcast:episode>`);

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

  // Tracks
  album.tracks.forEach(track => lines.push(generateTrackXml(track, album, 2)));

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
