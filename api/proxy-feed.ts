import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors } from './_utils/cors.js';
import { getExternalUrlError, fetchPublicUrl, UrlSafetyError } from './_utils/urlSafety.js';

// Feeds larger than this are refused to keep the proxy from relaying huge payloads
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Server-side proxy to fetch feeds - avoids CORS issues
 * GET /api/proxy-feed?url=<encoded-url>
 *
 * Users import feeds from arbitrary public hosts, so instead of a domain
 * allowlist this enforces that the target is on the public internet
 * (no private/loopback/link-local/metadata addresses, http(s) only).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS', public: true })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const urlError = getExternalUrlError(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  try {
    const response = await fetchPublicUrl(url, {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'MSP-FeedProxy/1.0'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch: ${response.statusText}`
      });
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_RESPONSE_BYTES) {
      return res.status(413).json({ error: 'Feed too large' });
    }

    const content = await response.text();
    if (content.length > MAX_RESPONSE_BYTES) {
      return res.status(413).json({ error: 'Feed too large' });
    }

    const contentType = response.headers.get('content-type') || 'application/xml';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 1 minute

    return res.status(200).send(content);
  } catch (error) {
    if (error instanceof UrlSafetyError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Proxy fetch error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch';
    return res.status(500).json({ error: message });
  }
}
