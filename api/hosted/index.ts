import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';
import { createHash, randomBytes } from 'crypto';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';

const PI_API_KEY = process.env.PODCASTINDEX_API_KEY;
const PI_API_SECRET = process.env.PODCASTINDEX_API_SECRET;

// Podcast Index notification result
interface PINotifyResult {
  success: boolean;
  message: string;
  podcastIndexId?: number;
}

// Submit feed to Podcast Index and return result
async function notifyPodcastIndex(feedUrl: string): Promise<PINotifyResult> {
  if (!PI_API_KEY || !PI_API_SECRET) {
    return { success: false, message: 'Podcast Index API not configured' };
  }

  try {
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = createHash('sha1')
      .update(PI_API_KEY + PI_API_SECRET + apiHeaderTime)
      .digest('hex');

    const headers = {
      'X-Auth-Key': PI_API_KEY,
      'X-Auth-Date': apiHeaderTime.toString(),
      'Authorization': hash,
      'User-Agent': 'MSP2.0/1.0 (Music Side Project Studio)'
    };

    const response = await fetch(`https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(feedUrl)}`, {
      method: 'POST',
      headers
    });

    // Handle potentially empty response body
    const responseText = await response.text();
    let data: any = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        // Response is not JSON - if status is ok, treat as success
        if (response.ok) {
          return { success: true, message: 'Feed submitted to Podcast Index' };
        }
        return { success: false, message: 'Podcast Index returned invalid response' };
      }
    } else if (response.ok) {
      // Empty response but status ok - treat as success
      return { success: true, message: 'Feed submitted to Podcast Index' };
    }

    if (data.status === true || data.status === 'true') {
      return {
        success: true,
        message: data.description || 'Feed submitted to Podcast Index',
        podcastIndexId: data.feed?.id
      };
    } else {
      // PI uses 'description' for messages, but check 'message' as fallback
      const errorMsg = data.description || data.message || data.error;
      return {
        success: false,
        message: errorMsg || 'Podcast Index rejected the feed'
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to notify Podcast Index';
    return { success: false, message };
  }
}

// Generate a secure edit token
function generateEditToken(): string {
  return randomBytes(32).toString('base64url');
}

// Hash token for storage (never store raw token)
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Get base URL from request
function getBaseUrl(req: VercelRequest): string {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET - List feeds (admin sees all, regular users see their own)
  if (req.method === 'GET') {
    // Check legacy admin key
    const adminKey = req.headers['x-admin-key'];
    const hasLegacyAdmin = process.env.MSP_ADMIN_KEY && adminKey === process.env.MSP_ADMIN_KEY;

    // Check Nostr auth header - first try admin, then regular user
    const authHeader = req.headers['authorization'] as string | undefined;
    const nostrAdminAuth = await parseAuthHeader(authHeader);
    const nostrUserAuth = !nostrAdminAuth.valid ? await parseFeedAuthHeader(authHeader) : nostrAdminAuth;

    const isAdmin = hasLegacyAdmin || nostrAdminAuth.valid;
    const userPubkey = nostrUserAuth.valid ? nostrUserAuth.pubkey : undefined;

    if (!isAdmin && !userPubkey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { blobs } = await list({ prefix: 'feeds/' });
      const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
      const xmlBlobs = blobs.filter(b => b.pathname.endsWith('.xml'));

      let feeds = await Promise.all(
        metaBlobs.map(async (blob) => {
          const response = await fetch(blob.url);
          const meta = await response.json();
          const feedId = blob.pathname.replace('feeds/', '').replace('.meta.json', '');

          // Try to extract author from the XML feed
          let author: string | undefined;
          const xmlBlob = xmlBlobs.find(b => b.pathname === `feeds/${feedId}.xml`);
          if (xmlBlob) {
            try {
              const xmlResponse = await fetch(xmlBlob.url);
              const xml = await xmlResponse.text();
              // Extract itunes:author using regex
              const authorMatch = xml.match(/<itunes:author>([^<]+)<\/itunes:author>/);
              if (authorMatch) {
                author = authorMatch[1];
              }
            } catch {
              // Ignore errors extracting author
            }
          }

          return { feedId, author, ...meta };
        })
      );

      // If not admin, filter to only show user's own feeds
      if (!isAdmin && userPubkey) {
        feeds = feeds.filter((feed: { ownerPubkey?: string }) => feed.ownerPubkey === userPubkey);
      }

      return res.status(200).json({ feeds, count: feeds.length });
    } catch (error) {
      console.error('Error listing feeds:', error);
      return res.status(500).json({ error: 'Failed to list feeds' });
    }
  }

  // POST - Create new feed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { xml, title, podcastGuid, editToken: clientToken } = req.body;

    // Validate input
    if (!xml || typeof xml !== 'string') {
      return res.status(400).json({ error: 'Missing XML content' });
    }

    if (!podcastGuid || typeof podcastGuid !== 'string') {
      return res.status(400).json({ error: 'Missing podcast GUID' });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(podcastGuid)) {
      return res.status(400).json({ error: 'Invalid podcast GUID format' });
    }

    // Basic XML validation
    if (!xml.trim().startsWith('<?xml') && !xml.trim().startsWith('<rss')) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    // Size limit: 1MB
    if (xml.length > 1024 * 1024) {
      return res.status(400).json({ error: 'XML content too large (max 1MB)' });
    }

    // Use podcast GUID as feed ID (one feed per podcast)
    const feedId = podcastGuid;

    // Check if feed already exists
    const { blobs } = await list({ prefix: `feeds/${feedId}.xml` });
    const existingFeed = blobs.find(b => b.pathname === `feeds/${feedId}.xml`);
    if (existingFeed) {
      return res.status(409).json({
        error: 'Feed already exists for this podcast. Use your edit token to update it, or use the Restore flow.',
        feedId
      });
    }

    // Use client-provided token or generate one
    const editToken = (typeof clientToken === 'string' && clientToken.length >= 32)
      ? clientToken
      : generateEditToken();
    const editTokenHash = hashToken(editToken);

    // Check for Nostr auth - if provided, set owner immediately
    const authHeader = req.headers['authorization'] as string | undefined;
    let ownerPubkey: string | undefined;
    let linkedAt: string | undefined;

    if (authHeader?.startsWith('Nostr ')) {
      const nostrAuth = await parseFeedAuthHeader(authHeader);
      if (nostrAuth.valid && nostrAuth.pubkey) {
        ownerPubkey = nostrAuth.pubkey;
        linkedAt = Date.now().toString();
      }
    }

    // Store feed XML in Vercel Blob
    const blob = await put(`feeds/${feedId}.xml`, xml, {
      access: 'public',
      contentType: 'application/rss+xml',
      addRandomSuffix: false
    });

    // Store metadata separately (Vercel Blob doesn't support custom metadata)
    await put(`feeds/${feedId}.meta.json`, JSON.stringify({
      editTokenHash,
      createdAt: Date.now().toString(),
      title: (typeof title === 'string' ? title : 'Untitled Feed').slice(0, 200),
      ownerPubkey,
      linkedAt
    }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    // Build stable URL
    const stableUrl = `${getBaseUrl(req)}/api/hosted/${feedId}.xml`;

    // Notify Podcast Index and get result
    const piResult = await notifyPodcastIndex(stableUrl);

    return res.status(201).json({
      feedId,
      editToken, // Only returned once at creation!
      url: stableUrl,
      blobUrl: blob.url,
      podcastIndex: piResult
    });
  } catch (error) {
    console.error('Error creating hosted feed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create feed';
    return res.status(500).json({ error: message });
  }
}
