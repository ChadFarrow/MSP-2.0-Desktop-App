import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeaders } from './_utils/podcastIndex.js';

// Extract Podcast Index feed ID from URL or plain number
function extractFeedId(input: string): string | null {
  // Check for podcastindex.org URL pattern
  const urlMatch = input.match(/podcastindex\.org\/podcast\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // Check if it's a plain number
  if (/^\d+$/.test(input.trim())) return input.trim();

  return null;
}

// Check if input looks like a UUID/GUID
function isGuid(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.trim());
}

// Check if input looks like a feed URL
function isFeedUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
           (input.includes('.xml') || input.includes('/feed') || input.includes('rss'));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  try {
    // Check if input is a feed ID, GUID, or feed URL
    const feedId = extractFeedId(q);
    const guid = isGuid(q) ? q.trim() : null;
    const feedUrl = isFeedUrl(q) ? q.trim() : null;

    let searchUrl: string;
    if (feedId) {
      searchUrl = `https://api.podcastindex.org/api/1.0/podcasts/byfeedid?id=${feedId}`;
    } else if (guid) {
      searchUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${guid}`;
    } else if (feedUrl) {
      searchUrl = `https://api.podcastindex.org/api/1.0/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`;
    } else {
      searchUrl = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(q)}`;
    }

    const response = await fetch(searchUrl, { headers: authHeaders });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.description || 'Search failed',
        details: data
      });
    }

    // Handle byfeedid/byguid/byfeedurl (single feed) and byterm (array of feeds) responses
    const rawFeeds = (feedId || guid || feedUrl) && data.feed ? [data.feed] : (data.feeds || []);

    const feeds = rawFeeds.map((feed: {
      id: number;
      title: string;
      podcastGuid: string;
      url: string;
      image: string;
    }) => ({
      id: feed.id,
      title: feed.title,
      podcastGuid: feed.podcastGuid,
      url: feed.url,
      image: feed.image
    }));

    return res.status(200).json({ feeds });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to search Podcast Index',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
