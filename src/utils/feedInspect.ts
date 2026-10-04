// Inspect an imported feed's own XML for what MSP will change or can't keep.
//
// The Feed check panel's live rules (feedChecks.ts) read the parsed feed in
// state. This reads the SOURCE instead, because several findings are invisible
// once parsed: two <podcast:value> blocks look like "no recipients", a missing
// <image><link> is only fixed by the generator, a legacy explicit word is gone.
//
// What gets reported — and what must not:
// - (a) what MSP changes on import or save, or can't keep, and
// - (b) what breaks, or will break, the feed in apps or validators.
// Never flag an element just because MSP doesn't model it. Unknown elements,
// extra namespaces, OP3 prefixes, channel-level <podcast:images>, extra txt
// tags, fee, valueTimeSplit and nested categories all round-trip untouched, and
// a feed full of them must inspect clean (a test pins that). Spec-invalid
// leftovers MSP drops with no value lost (funding with no url, a remoteItem
// with neither guid nor url, a podcast:image with no href) are not worth a line.
//
// Every claim a message makes about MSP's behaviour is asserted against the
// real parser and generator in feedInspect.test.ts. When a parser fix changes
// that behaviour (e.g. reading several value blocks), its paired test fails and
// forces the message here to change with it.
import { XMLValidator } from 'fast-xml-parser';
import { createFeedXmlParser } from './xmlParser';
import { detectAddressType } from './addressUtils';
import { MIN_PLAUSIBLE_MEDIA_BYTES } from './audioUtils';
import { LEGACY_MSP_NODE_PUBKEY } from '../types/feed';
import type { FeedIssue, IssueArea, IssueCode, IssueLevel } from './feedChecks';

type XmlNode = Record<string, unknown>;

const asArray = (node: unknown): unknown[] =>
  node === undefined || node === null ? [] : Array.isArray(node) ? node : [node];

// Same reading rules as xmlParser's private getText/getAttr.
function text(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in node) return String((node as XmlNode)['#text']);
  return '';
}

function attr(node: unknown, name: string): string {
  if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) return '';
  const key = `@_${name}`;
  return key in node ? String((node as XmlNode)[key]) : '';
}

const has = (node: unknown, key: string): boolean =>
  typeof node === 'object' && node !== null && !Array.isArray(node) && key in node && (node as XmlNode)[key] !== '';

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// Apple's older itunes:explicit vocabulary, and what MSP writes for each word.
const LEGACY_EXPLICIT_WORDS = new Map([['yes', true], ['explicit', true], ['no', false], ['clean', false]]);

/**
 * The XML validator's complaint, or null when the document is well formed.
 * Leading whitespace is skipped — a paste often starts with a newline, and the
 * validator would otherwise reject the `<?xml` declaration as "not at the start"
 * — but counted back into the line number, so it still matches what the user has.
 */
function xmlError(xml: string): { line: number; col: number; msg: string } | null {
  const body = xml.trimStart();
  const skippedLines = (xml.slice(0, xml.length - body.length).match(/\n/g) ?? []).length;
  const result = XMLValidator.validate(body);
  return result === true ? null : { line: result.err.line + skippedLines, col: result.err.col, msg: result.err.msg };
}

/**
 * The message for an import that failed outright.
 * - No <rss><channel> — a web page, an Atom feed — says so first. Real HTML is
 *   almost never well-formed XML, so letting the validator speak would describe
 *   a stray </head> instead of the actual problem.
 * - Otherwise the validator's line/column, since the parser's own errors
 *   ("Closing Tag is not closed.") say where nothing is.
 */
export function describeImportError(xml: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  if (message.includes('missing channel element')) {
    return "Couldn't import this feed: it has no <rss><channel>. MSP imports RSS feeds — Atom feeds and web pages won't load.";
  }
  const position = xml.trim() ? xmlError(xml) : null;
  if (position) {
    return `Couldn't import this feed: XML error at line ${position.line}, column ${position.col} — ${position.msg}`;
  }
  return `Couldn't import this feed: ${message}`;
}

/** Findings about the source XML. Never throws: a feed it can't read yields what was found so far. */
export function inspectFeedXml(xml: string): FeedIssue[] {
  const issues: FeedIssue[] = [];
  const add = (level: IssueLevel, code: IssueCode, area: IssueArea, message: string, itemIndex?: number) => {
    issues.push({ level, code, area, message, ...(itemIndex !== undefined ? { itemIndex } : {}) });
  };

  try {
    const position = xmlError(xml);
    if (position) {
      add('should', 'xml-malformed', 'file',
        `The imported file isn't valid XML (line ${position.line}, column ${position.col}: ${position.msg}). ` +
        'Strict apps may reject it, and MSP may have missed part of it — check nothing is missing. Saving from MSP writes valid XML.');
    }

    const channel = createFeedXmlParser().parse(xml)?.rss?.channel as XmlNode | undefined;
    if (!channel || typeof channel !== 'object') return issues;

    const medium = text(channel['podcast:medium']).trim();
    const isPublisher = medium === 'publisher';
    const isVideo = medium === 'video';
    const itemWord = isVideo ? 'video' : 'track';
    const items = asArray(channel.item);

    if (isPublisher) {
      inspectPublisher(channel, items, add);
    } else {
      inspectAlbum(channel, medium, add);
    }

    inspectChannelCommon(channel, add);
    // A publisher feed's items are dropped whole (publisher-items-dropped), so
    // nothing inside them is worth a separate line.
    inspectRecipients(channel, isPublisher ? [] : items, add);
    if (!isPublisher) inspectItems(items, itemWord, add);
  } catch {
    // A tree we can't walk is reported by xml-malformed (or by the import failing).
  }
  return issues;
}

type Add = (level: IssueLevel, code: IssueCode, area: IssueArea, message: string, itemIndex?: number) => void;

function inspectAlbum(channel: XmlNode, medium: string, add: Add) {
  if (!medium) {
    add('outdated', 'medium-missing', 'feed', 'The feed has no <podcast:medium>. MSP writes <podcast:medium>music</podcast:medium> when you save.');
  } else if (medium !== 'music' && medium !== 'video') {
    add('outdated', 'medium-changed', 'feed', `The feed's medium was "${medium}". MSP is for music, so it writes "music" when you save.`);
  }

  // <podcast:publisher> wrapping exactly one remoteItem is the spec form; the
  // parser also reads attributes on the wrapper, repeated remoteItems and a bare
  // channel-level remoteItem medium="publisher", and the generator rewrites them.
  const publisher = channel['podcast:publisher'];
  const bareRef = asArray(channel['podcast:remoteItem']).some(item => attr(item, 'medium') === 'publisher');
  const wrapperAttrs = publisher && (attr(publisher, 'feedGuid') || attr(publisher, 'feedUrl'));
  const repeated = publisher && typeof publisher === 'object' && Array.isArray((publisher as XmlNode)['podcast:remoteItem']);
  if (bareRef || wrapperAttrs || repeated) {
    add('outdated', 'publisher-ref-shape', 'feed', 'The link to your publisher feed uses a non-standard form. MSP writes the standard <podcast:publisher> block when you save.');
  }
}

function inspectPublisher(channel: XmlNode, items: unknown[], add: Add) {
  if (items.length > 0) {
    add('should', 'publisher-items-dropped', 'file',
      `This publisher feed has ${count(items.length, '<item>')}. A publisher feed lists albums, not tracks, so MSP leaves them out when you save.`);
  }
  const titledAsText = asArray(channel['podcast:remoteItem']).filter(item => !attr(item, 'title') && text(item).trim());
  if (titledAsText.length > 0) {
    const n = titledAsText.length;
    add('outdated', 'remote-item-title-text', 'catalog',
      `${n} catalog ${n === 1 ? 'entry' : 'entries'} carried the album title as element text. MSP writes it as the title attribute the spec defines.`);
  }
}

function inspectChannelCommon(channel: XmlNode, add: Add) {
  if (!text(channel.language).trim()) {
    add('outdated', 'language-missing', 'feed', 'The feed has no <language>. MSP set it to "en" — change it in the info section if that is wrong.');
  }
  if (!text(channel.pubDate).trim()) {
    add('outdated', 'pubdate-missing', 'feed', 'The feed has no <pubDate>. MSP uses the time of import.');
  }

  const explicitWord = text(channel['itunes:explicit']).trim().toLowerCase();
  if (LEGACY_EXPLICIT_WORDS.has(explicitWord)) {
    add('outdated', 'explicit-legacy', 'feed',
      `<itunes:explicit> is "${explicitWord}", the old form. MSP writes "${LEGACY_EXPLICIT_WORDS.get(explicitWord)}" when you save.`);
  }

  const image = channel.image;
  if (image && typeof image === 'object' && text((image as XmlNode).url).trim()
    && !text((image as XmlNode).link).trim() && text(channel.link).trim()) {
    add('outdated', 'image-link-missing', 'artwork', '<image> has no <link>, which RSS 2.0 requires. MSP adds your Website link when you save.');
  }

  if (Array.isArray(channel['podcast:value'])) {
    add('should', 'value-blocks-multiple', 'value',
      `The feed has ${channel['podcast:value'].length} <podcast:value> blocks. MSP can read only a single block, so it read none of them and the feed's splits are empty. Enter them again in the Value Block section.`);
  }
}

function inspectRecipients(channel: XmlNode, items: unknown[], add: Add) {
  const recipients: unknown[] = [];
  const collect = (block: unknown) => {
    // An array of blocks is reported as value-blocks-multiple; MSP reads none of it.
    if (Array.isArray(block)) return;
    recipients.push(...asArray(has(block, 'podcast:valueRecipient') ? (block as XmlNode)['podcast:valueRecipient'] : undefined));
  };
  collect(channel['podcast:value']);
  items.forEach(item => collect(has(item, 'podcast:value') ? (item as XmlNode)['podcast:value'] : undefined));

  let legacyNode = false;
  let wrongType = 0;
  const fractional: string[] = [];
  for (const recipient of recipients) {
    const address = attr(recipient, 'address');
    if (address.toLowerCase() === LEGACY_MSP_NODE_PUBKEY) {
      legacyNode = true;
      continue;
    }
    const type = attr(recipient, 'type');
    if (address && type && type !== detectAddressType(address)) wrongType++;
    const split = attr(recipient, 'split');
    if (split && String(parseInt(split)) !== split.trim()) {
      const who = attr(recipient, 'name') || address || 'a recipient';
      fractional.push(`"${who}" from ${split} to ${parseInt(split) || 0}`);
    }
  }

  if (legacyNode) {
    add('outdated', 'legacy-msp-node', 'value', 'The MSP support split pointed at the old MSP 1.0 node. MSP moved it to the MSP 2.0 Lightning address with the same split.');
  }
  if (wrongType > 0) {
    add('outdated', 'recipient-type', 'value',
      `${count(wrongType, 'value recipient')} had a type that didn't match the address (e.g. type="node" on a Lightning address). MSP writes the right type.`);
  }
  if (fractional.length > 0) {
    add('outdated', 'split-not-integer', 'value',
      `MSP reads whole-number splits only, so it changed ${fractional.join(', ')}. Check the splits are what you want.`);
  }
}

function inspectItems(items: unknown[], itemWord: string, add: Add) {
  let explicitLegacy = 0;
  let placeholderLength = 0;
  let missingGuid = 0;
  let missingPubDate = 0;
  let pluralImages = 0;

  items.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as XmlNode;

    if (LEGACY_EXPLICIT_WORDS.has(text(item['itunes:explicit']).trim().toLowerCase())) explicitLegacy++;
    if (!text(item.guid).trim()) missingGuid++;
    if (!text(item.pubDate).trim()) missingPubDate++;
    if (item['podcast:images']) pluralImages++;

    const enclosure = item.enclosure;
    if (enclosure && !Array.isArray(enclosure)) {
      const length = parseInt(attr(enclosure, 'length'), 10);
      if (!Number.isFinite(length) || length < MIN_PLAUSIBLE_MEDIA_BYTES) placeholderLength++;
    }

    if (Array.isArray(item['podcast:value'])) {
      add('should', 'value-blocks-multiple', 'tracks',
        `This ${itemWord} has ${item['podcast:value'].length} <podcast:value> blocks. MSP can read only a single block, so it read none of them and the ${itemWord} now pays the feed's splits. Turn on its own value block and enter the splits again if it needs them.`, index);
    }
    if (Array.isArray(item['podcast:transcript'])) {
      add('should', 'transcripts-multiple', 'tracks',
        `This ${itemWord} has ${item['podcast:transcript'].length} <podcast:transcript> files. MSP keeps one lyrics file per ${itemWord} and could not read these, so its Lyrics URL is empty. Enter the one to keep.`, index);
    }
  });

  if (explicitLegacy > 0) {
    add('outdated', 'explicit-legacy', 'tracks',
      `${count(explicitLegacy, itemWord)} used the old yes/no/clean form of <itunes:explicit>. MSP writes true or false when you save.`);
  }
  if (placeholderLength > 0) {
    add('outdated', 'enclosure-length-placeholder', 'tracks',
      `${count(placeholderLength, itemWord)} had no real file size (a missing or placeholder length). MSP measures each file, or estimates it from the duration when the host won't say.`);
  }
  if (missingGuid > 0) {
    add('outdated', 'item-guid-missing', 'tracks',
      missingGuid === 1
        ? `1 ${itemWord} had no <guid>, so MSP gave it a new one. Apps may list it as a new episode.`
        : `${missingGuid} ${itemWord}s had no <guid>, so MSP gave each a new one. Apps may list them as new episodes.`);
  }
  if (missingPubDate > 0) {
    add('outdated', 'pubdate-missing', 'tracks',
      `${count(missingPubDate, itemWord)} had no <pubDate>, so MSP used the time of import.`);
  }
  if (pluralImages > 0) {
    add('outdated', 'podcast-images-plural', 'tracks',
      `${count(pluralImages, itemWord)} used the deprecated <podcast:images> tag. MSP keeps the first image as the ${itemWord} art and drops the old tag.`);
  }
}
