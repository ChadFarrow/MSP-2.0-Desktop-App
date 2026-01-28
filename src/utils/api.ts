/**
 * API URL resolution utilities for cross-platform compatibility.
 *
 * In the web version, API calls use relative paths that are proxied by Vite in dev
 * or handled directly by Vercel in production.
 *
 * In the Tauri desktop app, there's no proxy, so API calls need absolute URLs
 * pointing to the production server.
 */

const PRODUCTION_API_BASE = 'https://msp.podtards.com';

/**
 * Detect if running in Tauri desktop environment.
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
};

/**
 * Get the base URL for API calls.
 * Returns the production URL for Tauri, empty string for web (relative paths).
 */
export function getApiBaseUrl(): string {
  if (import.meta.env.VITE_CANONICAL_URL) {
    return import.meta.env.VITE_CANONICAL_URL;
  }
  return isTauri() ? PRODUCTION_API_BASE : '';
}

/**
 * Resolve an API path to a full URL when needed.
 * @param path - API path like '/api/pisearch' or 'api/pisearch'
 * @returns Full URL for Tauri, original path for web
 */
export function resolveApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * Drop-in replacement for fetch() that resolves API URLs.
 * Use this for all /api/* calls to ensure they work in both web and desktop.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveApiUrl(path), init);
}
