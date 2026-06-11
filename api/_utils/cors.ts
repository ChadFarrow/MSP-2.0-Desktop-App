import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Origins allowed to call state-changing endpoints: the hosted web app,
 * the Tauri desktop webview (tauri://localhost on macOS, http://tauri.localhost
 * on Windows), and the local Vite dev server.
 */
const ALLOWED_ORIGINS = new Set([
  'https://msp.podtards.com',
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:5173'
]);

interface CorsOptions {
  /** Value for Access-Control-Allow-Methods on preflight, e.g. 'GET, POST, OPTIONS'. */
  methods: string;
  /** Value for Access-Control-Allow-Headers on preflight. Defaults to 'Content-Type'. */
  headers?: string;
  /** Public mode: any origin may call (read-only endpoints only). */
  public?: boolean;
}

/**
 * Apply CORS headers and handle the OPTIONS preflight.
 *
 * Restricted mode (default) echoes the request Origin only when it is in
 * ALLOWED_ORIGINS; requests without an Origin header (curl, podcast apps,
 * server-to-server) are unaffected by CORS and pass through as before.
 *
 * Returns true when the request was an OPTIONS preflight and has been fully
 * handled — the caller must return immediately without further processing.
 */
export function applyCors(req: VercelRequest, res: VercelResponse, options: CorsOptions): boolean {
  if (options.public) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const origin = req.headers?.origin;
    if (typeof origin === 'string' && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', options.methods);
    res.setHeader('Access-Control-Allow-Headers', options.headers ?? 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return true;
  }

  return false;
}
