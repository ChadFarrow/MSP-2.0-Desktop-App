// Video utilities

/**
 * Get video duration from URL using Video API
 */
export function getVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const video = document.createElement('video');
    video.preload = 'metadata';

    const done = (duration: number | null) => {
      if (resolved) return;
      resolved = true;
      video.src = '';
      resolve(duration);
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      done(isFinite(duration) && duration > 0 ? duration : null);
    };

    video.onerror = () => {
      done(null);
    };

    // Timeout after 10 seconds
    setTimeout(() => {
      done(null);
    }, 10000);

    video.src = url;
  });
}

/**
 * Read a video's height in pixels from its metadata, without CORS: a media
 * element exposes its dimensions for any origin, unlike a HEAD request's
 * Content-Length. Never rejects; null when the file fails to load, has no
 * picture, or takes longer than `timeoutMs`. `create` is for tests.
 */
export function detectVideoHeight(
  url: string,
  { timeoutMs = 10000, create = () => document.createElement('video') }: { timeoutMs?: number; create?: () => HTMLVideoElement } = {}
): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const video = create();
    video.preload = 'metadata';

    const done = (height: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      video.src = '';
      resolve(height);
    };

    video.onloadedmetadata = () => done(video.videoHeight > 0 ? video.videoHeight : null);
    video.onerror = () => done(null);
    const timer = setTimeout(() => done(null), timeoutMs);

    video.src = url;
  });
}

const VIDEO_MIME_BY_EXTENSION: ReadonlyArray<readonly [string, string]> = [
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/x-m4v'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.avi', 'video/x-msvideo'],
  ['.mkv', 'video/x-matroska'],
];

/**
 * Check if URL is a video URL based on extension (anywhere in the URL)
 */
export function isVideoUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return VIDEO_MIME_BY_EXTENSION.some(([ext]) => lowerUrl.includes(ext));
}

/**
 * Get video MIME type from URL extension (anywhere in the URL). Any other type
 * wins over .mp4, which is also the fallback.
 */
export function getVideoMimeType(url: string): string {
  const lowerUrl = url.toLowerCase();
  const match = VIDEO_MIME_BY_EXTENSION.find(([ext, mime]) => mime !== 'video/mp4' && lowerUrl.includes(ext));
  return match ? match[1] : 'video/mp4';
}

/**
 * The video MIME type of the extension the URL ends with (query and fragment
 * ignored), or null. Stricter than getVideoMimeType: a version's type follows
 * it, and "a.mov/song.mp3" is not a video.
 */
export function matchVideoExtension(url: string): string | null {
  const lower = url.toLowerCase().split('?')[0].split('#')[0];
  for (const [ext, mime] of VIDEO_MIME_BY_EXTENSION) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

/**
 * Every type matchVideoExtension() can produce, in table order (MP4 first),
 * labelled by its extensions and the type itself, for a file-type dropdown.
 */
export const VIDEO_FILE_TYPES: ReadonlyArray<{ value: string; label: string }> =
  VIDEO_MIME_BY_EXTENSION.map(([ext, mime]) => ({ value: mime, label: `${ext.slice(1).toUpperCase()} (${mime})` }));

/** The extensions matchVideoExtension() accepts, for a warning ("mp4, m4v, ..."). */
export const VIDEO_EXTENSION_LIST = VIDEO_MIME_BY_EXTENSION.map(([ext]) => ext.slice(1)).join(', ');
