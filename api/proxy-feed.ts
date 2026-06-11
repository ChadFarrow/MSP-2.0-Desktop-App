import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * True when a hostname points at a private, loopback, or link-local address —
 * the targets an SSRF attacker would aim at (cloud metadata, internal services).
 * String-based check on the literal host; covers IPv4 literals, IPv6 loopback,
 * and obvious internal names. Hostnames that resolve to private IPs via DNS are
 * not caught here, but combined with the domain allowlist below the surface is small.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  // IPv6 loopback / unique-local / link-local
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }

  // IPv4 literal checks
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  }

  return false;
}

/**
 * Server-side proxy to fetch feeds - avoids CORS issues
 * GET /api/proxy-feed?url=<encoded-url>
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Only allow http(s) — block file:, data:, gopher:, etc.
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Unsupported URL protocol' });
  }

  // Reject requests aimed at private, loopback, or link-local hosts (SSRF guard).
  if (isPrivateHost(parsedUrl.hostname)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  // Only allow fetching RSS/XML feeds from trusted podcast-host domains.
  const allowedDomains = [
    'msp.podtards.com',
    'feeds.podcastindex.org',
    'anchor.fm',
    'feeds.transistor.fm',
    'feeds.buzzsprout.com',
    'feeds.libsyn.com',
    'feeds.simplecast.com',
    'rss.art19.com',
    'feeds.megaphone.fm',
    'feeds.acast.com',
    'omnycontent.com',
    'pinecast.com',
    'podbean.com',
    'spreaker.com',
    'audioboom.com',
    'soundcloud.com'
  ];

  const isDomainAllowed = allowedDomains.some(domain =>
    parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`)
  );

  if (!isDomainAllowed) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'MSP-FeedProxy/1.0'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`
      });
    }

    const content = await response.text();
    const contentType = response.headers.get('content-type') || 'application/xml';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 1 minute

    return res.status(200).send(content);
  } catch (error) {
    console.error('Proxy fetch error:', error);
    return res.status(502).json({ error: 'Failed to fetch feed' });
  }
}
