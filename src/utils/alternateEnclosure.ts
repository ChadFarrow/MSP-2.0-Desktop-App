// Editing rules for a track's alternate versions (<podcast:alternateEnclosure>).
// Kept out of AlternateEnclosuresList so they run under unit tests in node.
import type { Album, AlternateEnclosure, AlternateEnclosureFile } from '../types/feed';
import { isVideoMedium } from '../types/feed';
import { detectMediaSize, getAudioMimeType, isKnownAudioFormat } from './audioUtils';
import { getVideoMimeType, isVideoUrl } from './videoUtils';

/**
 * True when the editor shows Alternate Versions for this feed: album tracks
 * only, for now (audio first; video versions are a later step). The Feed check
 * and the link check use the same test, so they report nothing the user has no
 * field to fix. It goes by medium, as the editor does, not by which slot the
 * feed is in: Load from Nostr puts a video feed in the album slot.
 */
export function editsAlternateVersions(album: Pick<Album, 'medium'>): boolean {
  return !isVideoMedium(album.medium);
}

/**
 * A <podcast:source> on a network other than the web. The spec allows them (its
 * examples use ipfs://); OP3 cannot prefix them and the link check cannot probe
 * them, but they are not a mistake to report.
 */
export const NON_WEB_SOURCE_RE = /^(ipfs|ipns|magnet|ar):/i;

const INTEGRITY = 'podcast:integrity';

// The version's children with `integrity` as its <podcast:integrity> entry
// (none when undefined).
function withIntegrity(elements: Record<string, unknown> | undefined, integrity: unknown): Record<string, unknown> | undefined {
  const rest = { ...elements };
  delete rest[INTEGRITY];
  if (integrity !== undefined) rest[INTEGRITY] = integrity;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

// What describes the file at the version's URL right now.
function describeFile(enc: AlternateEnclosure): AlternateEnclosureFile {
  return {
    source: enc.sources[0] ?? { uri: '' },
    type: enc.type,
    length: enc.length,
    bitrate: enc.bitrate,
    height: enc.height,
    codecs: enc.codecs,
    integrity: enc.unknownElements?.[INTEGRITY]
  };
}

/**
 * What changes when the user edits a version's URL (its first source). Each
 * keystroke is one call. A new file drops what described the old one — size,
 * bitrate, height, codecs, the source's own attributes and any
 * <podcast:integrity> hash — and keeps it in `originalFile`, so an edit that
 * returns to the old URL (type a character, delete it) gets all of it back.
 * Imported mirrors stay. The type follows a recognized extension, as for the
 * main file, until the user picks one by hand.
 */
export function urlChange(enc: AlternateEnclosure, url: string): Partial<AlternateEnclosure> {
  const [first, ...mirrors] = enc.sources;
  // Only the surrounding spaces changed: the file is the same.
  if ((first?.uri ?? '').trim() === url.trim()) {
    return { sources: [{ ...first, uri: url }, ...mirrors] };
  }

  const original = enc.originalFile ?? describeFile(enc);
  if (original.source.uri.trim() === url.trim()) {
    const type = enc.typeSetByHand ? enc.type : original.type;
    return {
      sources: [{ ...original.source, uri: url }, ...mirrors],
      type,
      length: original.length,
      bitrate: original.bitrate,
      height: original.height,
      // RFC 6381 codecs belong to a type; not under one the user picked since.
      codecs: type === original.type ? original.codecs : undefined,
      unknownElements: withIntegrity(enc.unknownElements, original.integrity),
      originalFile: undefined
    };
  }

  const patch: Partial<AlternateEnclosure> = {
    sources: [{ uri: url }, ...mirrors],
    length: undefined,
    bitrate: undefined,
    height: undefined,
    codecs: undefined,
    unknownElements: withIntegrity(enc.unknownElements, undefined),
    originalFile: original
  };
  if (url.trim() && !enc.typeSetByHand) {
    if (isKnownAudioFormat(url)) patch.type = getAudioMimeType(url);
    else if (enc.type.startsWith('video/') && isVideoUrl(url)) patch.type = getVideoMimeType(url);
  }
  return patch;
}

/**
 * What changes when the user picks a type in the File Type list. It sticks: a
 * later URL edit no longer sets the type. Codecs (RFC 6381) belong to a type,
 * so they go when the type changes.
 */
export function typeChange(enc: AlternateEnclosure, type: string): Partial<AlternateEnclosure> {
  return { type, typeSetByHand: true, ...(type !== enc.type ? { codecs: undefined } : {}) };
}

/**
 * Returns `measure(id, url)`, which reads a version's file size from the host
 * and reports it with `write(id, url, length)`. The HEAD request can take ~10 s,
 * and by then the user may have edited the list, moved the track or closed it,
 * so `write` must not go through anything a render closed over: the editor
 * dispatches SET_ALTERNATE_ENCLOSURE_LENGTH, which finds the track and the
 * version by id and applies withMeasuredLength().
 */
export function createSizeMeasurer(options: {
  write: (id: string, url: string, length: string) => void;
  detect?: (url: string) => Promise<number | null>;
}): (id: string, url: string) => Promise<void> {
  const { write, detect = detectMediaSize } = options;
  // Paste then blur asks twice for the same URL; send one request.
  const inFlight = new Set<string>();

  return async (id, rawUrl) => {
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = `${id} ${url}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const size = await detect(url);
      if (size !== null) write(id, url, String(size));
    } finally {
      inFlight.delete(key);
    }
  };
}

/**
 * The list with a measured size written to version `id`, or null when it no
 * longer belongs there: the version went, its URL is no longer `url`, or the
 * user typed a size meanwhile.
 */
export function withMeasuredLength(
  enclosures: AlternateEnclosure[],
  id: string,
  url: string,
  length: string
): AlternateEnclosure[] | null {
  const enc = enclosures.find(e => e.id === id);
  if (!enc || enc.length || enc.sources[0]?.uri.trim() !== url.trim()) return null;
  return enclosures.map(e => (e.id === id ? { ...e, length } : e));
}
