// Helpers for auto-deriving <podcast:image> attributes from an image URL.

// Common aspect ratios (spoken form) to snap near-matches to, so a 1376×768 image
// reads as "16/9" instead of an ugly exact "43/24". Both orientations included.
const COMMON_RATIOS: [number, number][] = [
  [1, 1],
  [5, 4], [4, 5],
  [4, 3], [3, 4],
  [3, 2], [2, 3],
  [16, 10], [10, 16],
  [16, 9], [9, 16],
  [21, 9], [9, 21],
  [2, 1], [1, 2],
  [3, 1], [1, 3],
  [4, 1], [1, 4],
];
const RATIO_SNAP_TOLERANCE = 0.02; // 2% relative — close enough that a few off pixels still reads as the intended ratio

// Reduce width/height to a simplified CSS aspect-ratio string. Snaps to a common
// ratio when within tolerance (e.g. 1376×768 -> "16/9"), else exact GCD reduction.
export function reduceRatio(width: number, height: number): string {
  if (!width || !height) return '';
  const target = width / height;
  let best: { w: number; h: number; err: number } | null = null;
  for (const [w, h] of COMMON_RATIOS) {
    const err = Math.abs(target - w / h) / (w / h);
    if (err <= RATIO_SNAP_TOLERANCE && (!best || err < best.err)) {
      best = { w, h, err };
    }
  }
  if (best) return `${best.w}/${best.h}`;
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
//   square-ish (~1:1)        -> artwork  (alternate cover)
//   very wide (>= ~2.5:1)    -> banner   (wide hero strip, ~3:1 / 4:1)
//   everything else          -> canvas   (full-screen background: 16:9/landscape desktop or portrait phone)
// The artist can always override; this just picks the most likely bucket.
export function suggestPurpose(aspectRatio: string): string {
  const [w, h] = aspectRatio.split('/').map(Number);
  if (!w || !h) return '';
  const ratio = w / h;
  if (ratio >= 0.9 && ratio <= 1.1) return 'artwork';
  if (ratio >= 2.5) return 'banner';
  return 'canvas';
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (meta: DetectedImageMeta) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(meta);
    };
    img.onload = () => {
      const width = img.naturalWidth || undefined;
      const height = img.naturalHeight || undefined;
      const aspectRatio = width && height ? reduceRatio(width, height) : undefined;
      done({ width, height, aspectRatio, type: type || undefined });
    };
    img.onerror = () => done({ type: type || undefined });
    // Timeout after 10 seconds — some CDNs stall without firing onerror.
    // Resolves with best-available partial data rather than leaving the Promise pending.
    timer = setTimeout(() => {
      done(type ? { type } : {});
    }, 10000);
    img.src = url;
  });
}
