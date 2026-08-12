import { lookup } from 'node:dns/promises';

/**
 * SSRF protection for endpoints that fetch user-supplied URLs.
 *
 * Feed import must work for arbitrary public hosts, so this validates that a
 * URL points at the public internet rather than enforcing a domain allowlist:
 * only http(s), no credentials, no localhost/.local/.internal names, no
 * private/reserved IP literals, and (for hostnames) no DNS resolution to a
 * private address. Redirects are re-validated hop by hop in fetchPublicUrl.
 */

/**
 * Re-exported so upstream handlers keep working unchanged: the web repo defines
 * getClientIp here, while this fork keeps it next to the rate limiter that is its
 * only consumer (and hardens it to prefer the proxy headers a client can't spoof).
 * Importing it from either module resolves.
 */
export { getClientIp } from './rateLimiter.js';

/** Thrown by fetchPublicUrl when a URL or redirect target is unsafe. */
export class UrlSafetyError extends Error {}

function parseIpv4(host: string): number | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some(p => p > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

// [network address, prefix bits] — private, loopback, link-local, CGNAT,
// "this network", multicast/reserved/broadcast
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3]
];

function isBlockedIpv4(address: string): boolean {
  const ip = parseIpv4(address);
  if (ip === null) return false;
  return BLOCKED_IPV4_RANGES.some(([network, bits]) => {
    const base = parseIpv4(network);
    if (base === null) return false;
    const mask = (~0 << (32 - bits)) >>> 0;
    return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function isBlockedIpv6(address: string): boolean {
  const host = address.toLowerCase();
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  // IPv4-mapped, dotted form (::ffff:127.0.0.1)
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]) || parseIpv4(mapped[1]) === null;
  // IPv4-mapped, hex form — URL normalizes the dotted form to this (::ffff:7f00:1)
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isBlockedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

/**
 * True when a literal hostname points at a private, loopback, link-local or
 * otherwise reserved address — the targets an SSRF attacker aims at (cloud
 * metadata, internal services). Hostnames that resolve to a private IP via DNS
 * are not caught here; use assertPublicHttpUrl or getDnsSafetyError, which resolve.
 *
 * The IPv6 checks run only when the host is actually an IPv6 literal. fc00::/7 and
 * fe80::/10 are matched by string prefix, and a bare hostname starting with those
 * same letters is an ordinary public domain — fdrecords.com, fcmusic.net, fcc.gov.
 * A hostname can never contain a colon (URL.hostname excludes the port), so the
 * colon is a safe discriminator.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (isBlockedHostname(host)) return true;
  return host.includes(':') ? isBlockedIpv6(host) : isBlockedIpv4(host);
}

/** Strip the brackets URL.hostname keeps around IPv6 literals. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/**
 * Synchronous safety checks. Returns an error message for unsafe URLs,
 * or null when the URL passes (DNS resolution is checked separately).
 */
export function getExternalUrlError(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http(s) URLs are allowed';
  }
  if (url.username || url.password) {
    return 'URLs with embedded credentials are not allowed';
  }
  if (isPrivateHost(bareHostname(url))) {
    return 'Host not allowed';
  }
  return null;
}

/**
 * Resolve a hostname and reject if any address is private/reserved.
 * Returns an error message, or null when the host resolves publicly.
 * (Best-effort: a TOCTOU window between this check and the fetch remains.)
 */
export async function getDnsSafetyError(rawUrl: string): Promise<string | null> {
  const hostname = bareHostname(new URL(rawUrl));
  // IP literals were already validated synchronously
  if (parseIpv4(hostname) !== null || hostname.includes(':')) {
    return null;
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return 'Could not resolve host';
  }
  for (const { address, family } of addresses) {
    if (family === 4 && isBlockedIpv4(address)) return 'Host resolves to a private address';
    if (family === 6 && isBlockedIpv6(address)) return 'Host resolves to a private address';
  }
  return null;
}

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Full pre-flight for fetching a user-supplied URL, as a result object rather than
 * an error message: protocol, literal host, and the addresses the hostname actually
 * resolves to. Same checks as getExternalUrlError + getDnsSafetyError above — this
 * is the shape the web repo's handlers (verify-feed-url, safeFetch, feedProbe) call,
 * and the status split is the part that carries meaning. 403 means MSP refused the
 * address; 400 means the URL itself is unusable, which callers report as a verdict
 * about the user's input rather than a refusal.
 *
 * Call this on every redirect hop too, not only the first URL.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 400, error: 'Invalid URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'Unsupported URL protocol' };
  }

  // Credentials are a refusal, not a malformed URL: http://user:pass@host is a
  // well-formed URL asking us to authenticate somewhere on the caller's behalf.
  if (url.username || url.password) {
    return { ok: false, status: 403, error: 'Address not allowed' };
  }

  if (isPrivateHost(bareHostname(url))) {
    return { ok: false, status: 403, error: 'Address not allowed' };
  }

  const dnsError = await getDnsSafetyError(url.toString());
  if (dnsError) {
    // A name that doesn't resolve is unreachable, not unsafe — the caller turns
    // that into "that URL didn't load", which is what it means.
    return dnsError === 'Could not resolve host'
      ? { ok: false, status: 400, error: dnsError }
      : { ok: false, status: 403, error: 'Address not allowed' };
  }

  return { ok: true, url };
}

/**
 * Fetch a user-supplied URL with SSRF protection, following up to
 * maxRedirects redirects and re-validating every hop.
 * Throws UrlSafetyError when the URL or a redirect target is unsafe.
 */
export async function fetchPublicUrl(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const urlError = getExternalUrlError(currentUrl);
    if (urlError) throw new UrlSafetyError(urlError);
    const dnsError = await getDnsSafetyError(currentUrl);
    if (dnsError) throw new UrlSafetyError(dnsError);

    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new UrlSafetyError('Too many redirects');
}
