import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const API_KEY = process.env.PODCASTINDEX_API_KEY;
const API_SECRET = process.env.PODCASTINDEX_API_SECRET;

// Generate Podcast Index API auth headers
function getAuthHeaders() {
  if (!API_KEY || !API_SECRET) return null;

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash('sha1')
    .update(API_KEY + API_SECRET + apiHeaderTime)
    .digest('hex');

  return {
    'X-Auth-Key': API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hash,
    'User-Agent': 'MSP2.0/1.0 (Music Side Project Studio)'
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, guid } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // GUID is optional but preferred for lookup
  const podcastGuid = typeof guid === 'string' ? guid : undefined;

  try {
    // Validate URL format
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    // First, notify Podcast Index about the feed (no auth required)
    const pubnotifyUrl = `https://api.podcastindex.org/api/1.0/hub/pubnotify?url=${encodeURIComponent(url)}`;
    const notifyResponse = await fetch(pubnotifyUrl, {
      headers: {
        'User-Agent': 'MSP2.0/1.0 (Music Side Project Studio)'
      }
    });

    // Handle potentially empty response body
    const notifyText = await notifyResponse.text();
    let notifyData: Record<string, unknown> = {};
    if (notifyText) {
      try {
        notifyData = JSON.parse(notifyText);
      } catch {
        // Response is not JSON, treat as success if status is ok
      }
    }

    if (!notifyResponse.ok) {
      return res.status(notifyResponse.status).json({
        error: notifyData.description || 'Failed to notify Podcast Index',
        details: notifyData
      });
    }

    // Then, look up the feed to get its Podcast Index ID (requires auth)
    // Try GUID lookup first (more reliable), fall back to URL lookup
    let podcastIndexId: number | null = null;
    let podcastIndexPageUrl: string | null = null;

    const authHeaders = getAuthHeaders();
    if (authHeaders) {
      // Try lookup by GUID first if available
      if (podcastGuid) {
        try {
          const lookupUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`;
          const lookupResponse = await fetch(lookupUrl, { headers: authHeaders });
          const lookupData = await lookupResponse.json();

          if (lookupResponse.ok && lookupData.feed?.id) {
            podcastIndexId = lookupData.feed.id;
            podcastIndexPageUrl = `https://podcastindex.org/podcast/${podcastIndexId}`;
          }
        } catch (lookupErr) {
          console.warn('Failed to lookup feed by GUID:', lookupErr);
        }
      }

      // Fall back to URL lookup if GUID lookup didn't find a result
      if (!podcastIndexId) {
        try {
          const lookupUrl = `https://api.podcastindex.org/api/1.0/podcasts/byfeedurl?url=${encodeURIComponent(url)}`;
          const lookupResponse = await fetch(lookupUrl, { headers: authHeaders });
          const lookupData = await lookupResponse.json();

          if (lookupResponse.ok && lookupData.feed?.id) {
            podcastIndexId = lookupData.feed.id;
            podcastIndexPageUrl = `https://podcastindex.org/podcast/${podcastIndexId}`;
          }
        } catch (lookupErr) {
          // Lookup failed but pubnotify succeeded, continue without ID
          console.warn('Failed to lookup feed by URL:', lookupErr);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Feed submitted to Podcast Index',
      podcastIndexId,
      podcastIndexUrl: podcastIndexPageUrl,
      details: notifyData
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to contact Podcast Index',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
