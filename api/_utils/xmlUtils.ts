/**
 * Extract the <podcast:medium> value from raw RSS XML.
 * Returns undefined if the tag is absent or empty.
 */
export function extractPodcastMedium(xml: string): string | undefined {
  return xml.match(/<podcast:medium>([^<]+)<\/podcast:medium>/)?.[1];
}
