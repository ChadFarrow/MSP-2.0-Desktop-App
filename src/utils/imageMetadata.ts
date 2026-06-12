// Helpers for auto-deriving <podcast:image> attributes from an image URL.

// Reduce width/height to a simplified CSS aspect-ratio string, e.g. 1920x1080 -> "16/9".
export function reduceRatio(width: number, height: number): string {
  if (!width || !height) return '';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return `${width / g}/${height / g}`;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

// Infer a MIME type from a URL's file extension. Returns '' when unknown.
export function mimeFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  const ext = clean.slice(dot + 1).toLowerCase();
  return EXT_MIME[ext] || '';
}

// Suggest a default purpose token from an aspect-ratio string like "16/9".
// Square-ish -> artwork; wider than square -> banner; otherwise '' (let the artist choose).
export function suggestPurpose(aspectRatio: string): string {
  const [w, h] = aspectRatio.split('/').map(Number);
  if (!w || !h) return '';
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'artwork';
  if (ratio > 1.1) return 'banner';
  return '';
}

export interface DetectedImageMeta {
  width?: number;
  height?: number;
  aspectRatio?: string;
  type?: string;
}

// Load an image in the browser to read its natural dimensions, then derive
// aspect-ratio and MIME. NEVER throws/rejects; resolves with whatever could be
// detected (an href alone is a valid <podcast:image>). Browser-only — not unit-tested.
export function detectImageMetadata(url: string): Promise<DetectedImageMeta> {
  return new Promise((resolve) => {
    if (!url) {
      resolve({});
      return;
    }
    const type = mimeFromUrl(url);
    const img = new Image();
    let settled = false;
    const done = (meta: DetectedImageMeta) => {
      if (settled) return;
      settled = true;
      resolve(meta);
    };
    img.onload = () => {
      const width = img.naturalWidth || undefined;
      const height = img.naturalHeight || undefined;
      const aspectRatio = width && height ? reduceRatio(width, height) : undefined;
      done({ width, height, aspectRatio, type: type || undefined });
    };
    img.onerror = () => done({ type: type || undefined });
    img.src = url;
  });
}
