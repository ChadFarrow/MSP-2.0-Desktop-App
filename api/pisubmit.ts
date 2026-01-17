import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const API_KEY = process.env.PODCASTINDEX_API_KEY;
const API_SECRET = process.env.PODCASTINDEX_API_SECRET;

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  try {
    const submitUrl = `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(url)}`;

    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: authHeaders
    });
    const data = await response.json();

    // Podcast Index returns status in the response body
    if (data.status === 'false' || data.status === false) {
      return res.status(400).json({
        error: data.description || 'Submit failed',
        details: data
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.description || 'Submit failed',
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      message: data.description || 'Feed submitted successfully',
      feedId: data.feedId || data.feed?.id
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to submit to Podcast Index',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
