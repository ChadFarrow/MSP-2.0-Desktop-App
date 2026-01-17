import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  // Only allow fetching RSS/XML feeds from trusted domains
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
    'soundcloud.com',
    'localhost'
  ];

  const isDomainAllowed = allowedDomains.some(domain =>
    parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`)
  );

  if (!isDomainAllowed) {
    // For unlisted domains, still allow but log it
    console.log(`Proxy fetch from unlisted domain: ${parsedUrl.hostname}`);
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
    const message = error instanceof Error ? error.message : 'Failed to fetch';
    return res.status(500).json({ error: message });
  }
}
