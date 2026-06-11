import { XMLValidator } from 'fast-xml-parser';

/**
 * Extract the <podcast:medium> value from raw RSS XML.
 * Returns undefined if the tag is absent or empty.
 */
export function extractPodcastMedium(xml: string): string | undefined {
  return xml.match(/<podcast:medium>([^<]+)<\/podcast:medium>/)?.[1];
}

/**
 * Check that a string is well-formed XML with an <rss> root.
 * Run any size limit BEFORE this — validation walks the whole document.
 */
export function isWellFormedRss(xml: string): boolean {
  const trimmed = xml.trim();
  if (!/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<rss[\s>]/.test(trimmed)) {
    return false;
  }
  return XMLValidator.validate(trimmed) === true;
}
