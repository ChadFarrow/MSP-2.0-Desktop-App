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
