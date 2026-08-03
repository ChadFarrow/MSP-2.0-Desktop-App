// Audio and duration utilities
import { getVideoDuration, isVideoUrl } from './videoUtils';

const AUDIO_MIME_BY_EXTENSION: ReadonlyArray<readonly [string, string]> = [
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/x-m4a'],
  ['.m4b', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.wav', 'audio/wav'],
  ['.opus', 'audio/opus'],
  ['.oga', 'audio/ogg'],
  ['.ogg', 'audio/ogg'],
  ['.aiff', 'audio/aiff'],
  ['.aif', 'audio/aiff'],
  ['.wma', 'audio/x-ms-wma'],
];

function matchAudioExtension(url: string): string | null {
  const lower = url.toLowerCase().split('?')[0].split('#')[0];
  for (const [ext, mime] of AUDIO_MIME_BY_EXTENSION) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

/**
 * Detect audio MIME type from URL extension. Falls back to audio/mpeg.
 */
export function getAudioMimeType(url: string): string {
  return matchAudioExtension(url) ?? 'audio/mpeg';
}

/**
 * True when the URL ends with a recognized audio extension (mp3, flac, wav, m4a, aac, ogg, opus, aiff, wma).
 */
export function isKnownAudioFormat(url: string): boolean {
  return matchAudioExtension(url) !== null;
}

/**
 * Get MP3 duration from URL using Audio API (works without CORS)
 */
export function getAudioDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const audio = new Audio();
    audio.preload = 'metadata';

    const done = (duration: number | null) => {
      if (resolved) return;
      resolved = true;
      audio.src = '';
      resolve(duration);
    };

    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      done(isFinite(duration) && duration > 0 ? duration : null);
    };

    audio.onerror = () => {
      done(null);
    };

    // Timeout after 10 seconds
    setTimeout(() => {
      done(null);
    }, 10000);

    audio.src = url;
  });
}

/**
 * Smallest byte count we'll believe for a real audio/video file. Anything under this
 * is a placeholder from some generator rather than a measurement — MSP itself used to
 * write a literal `33` for every track — so it's treated as "unknown" on import.
 */
export const MIN_PLAUSIBLE_MEDIA_BYTES = 1024;

/** Bytes per second of a 128 kbps encode, used to estimate an unmeasurable file. */
const ESTIMATED_BYTES_PER_SECOND = 16000;

/** Last-resort enclosure size (~5 MB) when neither the host nor a duration will tell us. */
const FALLBACK_MEDIA_BYTES = 5_000_000;

/**
 * Read a media file's real byte size with a HEAD request.
 *
 * `Content-Length` is a CORS-safelisted response header, so this works on any host
 * that sends `Access-Control-Allow-Origin` — the host does NOT need to list it in
 * `Access-Control-Expose-Headers`. Hosts that send no CORS headers fail the fetch.
 * Like getAudioDuration and detectImageMetadata this never rejects; it resolves null
 * so callers can fall back.
 */
export async function detectMediaSize(url: string, timeoutMs = 10000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (!response.ok) return null;
    const header = response.headers.get('content-length');
    if (!header) return null;
    const bytes = parseInt(header, 10);
    return Number.isFinite(bytes) && bytes >= MIN_PLAUSIBLE_MEDIA_BYTES ? bytes : null;
  } catch {
    return null; // CORS-blocked, offline, or timed out — caller estimates instead
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort enclosure size in bytes. Prefers the host's real Content-Length; falls
 * back to a duration-based estimate, then to a generic value. Always returns a number
 * because RSS requires the enclosure `length` attribute — but only the first branch is
 * a measurement, so prefer it wherever the host allows.
 */
export async function resolveMediaSize(url: string, durationSeconds?: number | null): Promise<number> {
  const measured = await detectMediaSize(url);
  if (measured !== null) return measured;
  if (durationSeconds && durationSeconds > 0) {
    return Math.round(durationSeconds * ESTIMATED_BYTES_PER_SECOND);
  }
  return FALLBACK_MEDIA_BYTES;
}

/**
 * Parse an HH:MM:SS (or MM:SS / SS) duration back into seconds. Returns null when the
 * value is empty or unparseable.
 */
export function hhmmssToSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(':').map(p => parseInt(p, 10));
  if (parts.some(p => !Number.isFinite(p))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

/**
 * Convert seconds to HH:MM:SS format
 */
export function secondsToHHMMSS(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Format duration input to HH:MM:SS, handling various input formats
 */
export function formatDuration(input: string): string {
  const cleaned = input.replace(/[^\d:]/g, '');
  const parts = cleaned.split(':').map(p => parseInt(p) || 0);

  let hours = 0, minutes = 0, seconds = 0;

  if (parts.length === 1) {
    seconds = parts[0];
  } else if (parts.length === 2) {
    minutes = parts[0];
    seconds = parts[1];
  } else if (parts.length >= 3) {
    hours = parts[0];
    minutes = parts[1];
    seconds = parts[2];
  }

  if (seconds >= 60) {
    minutes += Math.floor(seconds / 60);
    seconds = seconds % 60;
  }
  if (minutes >= 60) {
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Get media duration - detects URL type and calls appropriate function
 */
export function getMediaDuration(url: string): Promise<number | null> {
  if (isVideoUrl(url)) {
    return getVideoDuration(url);
  }
  return getAudioDuration(url);
}
