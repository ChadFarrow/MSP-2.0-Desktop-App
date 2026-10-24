// Editing rules for a track's alternate versions (<podcast:alternateEnclosure>).
// Kept out of AlternateEnclosuresList so they run under unit tests in node.
import type { Album, AlternateEnclosure, AlternateEnclosureFile, Track } from '../types/feed';
import { isVideoMedium } from '../types/feed';
import { getAudioMimeType, isKnownAudioFormat } from './audioUtils';
import { matchVideoExtension } from './videoUtils';

/**
 * True when the editor shows Alternate Versions for this feed: album tracks
 * only, for now (audio first; video versions are a later step). The Feed check
 * and the link check use the same test, so they report nothing the user has no
 * field to fix — they only report versions a track has, and
 * showsAlternateVersions always shows those. It goes by medium, as the editor
 * does, not by which slot the feed is in: Load from Nostr puts a video feed in
 * the album slot.
 */
export function editsAlternateVersions(album: Pick<Album, 'medium'>): boolean {
  return !isVideoMedium(album.medium);
}

/**
 * Whether a track shows Alternate Versions. Adding a version is a beta feature,
 * so an empty section (and "+ Add") needs the beta toggle. A track that already
 * has one (from an import) shows it whatever the toggle, because the generator
 * still writes it and the Feed check and link check still report it: hiding it
 * would leave the user no field to fix or remove it in.
 */
export function showsAlternateVersions(
  album: Pick<Album, 'medium'>,
  track: Pick<Track, 'alternateEnclosures'>,
  showBeta: boolean
): boolean {
  return editsAlternateVersions(album)
    && (showBeta || (track.alternateEnclosures?.length ?? 0) > 0);
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
    // An audio or a video extension: a version can be a music video.
    const type = isKnownAudioFormat(url) ? getAudioMimeType(url) : matchVideoExtension(url);
    if (type) patch.type = type;
  }
  return patch;
}

/**
 * What changes when the user picks a type in the File Type list. It sticks: a
 * later URL edit no longer sets the type. Codecs (RFC 6381) belong to a type,
 * so they go when the type changes, and a height only describes a video.
 */
export function typeChange(enc: AlternateEnclosure, type: string): Partial<AlternateEnclosure> {
  return {
    type,
    typeSetByHand: true,
    ...(type !== enc.type ? { codecs: undefined } : {}),
    ...(isVideoType(type) ? {} : { height: undefined })
  };
}

/** True for a video MIME type: the version is a video (a music video). */
export function isVideoType(type: string): boolean {
  return type.startsWith('video/');
}

/** A value MSP measures for a version from its file: the size, or a video's height. */
export type MeasuredField = 'length' | 'height';

/**
 * Returns `measure(id, url)`, which reads one value from a version's file with
 * `detect` (detectMediaSize for the size, detectVideoHeight for the height) and
 * reports it with `write(id, url, value)`. The lookup can take ~10 s, and by
 * then the user may have edited the list, moved the track or closed it, so
 * `write` must not go through anything a render closed over: the editor
 * dispatches SET_ALTERNATE_ENCLOSURE_MEASURED, which finds the track and the
 * version by id and applies withMeasured().
 */
export function createMeasurer(options: {
  write: (id: string, url: string, value: string) => void;
  detect: (url: string) => Promise<number | null>;
}): (id: string, url: string) => Promise<void> {
  const { write, detect } = options;
  // Paste then blur asks twice for the same URL; send one request.
  const inFlight = new Set<string>();

  return async (id, rawUrl) => {
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = `${id} ${url}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const value = await detect(url);
      if (value !== null) write(id, url, String(value));
    } finally {
      inFlight.delete(key);
    }
  };
}

/**
 * The list with a measured `field` written to version `id`, or null when it no
 * longer belongs there: the version went, its URL is no longer `url`, or the
 * user typed that field meanwhile.
 */
export function withMeasured(
  enclosures: AlternateEnclosure[],
  id: string,
  url: string,
  field: MeasuredField,
  value: string
): AlternateEnclosure[] | null {
  const enc = enclosures.find(e => e.id === id);
  if (!enc || enc[field] || enc.sources[0]?.uri.trim() !== url.trim()) return null;
  return enclosures.map(e => (e.id === id ? { ...e, [field]: value } : e));
}
