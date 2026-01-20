import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';
import { createHash, randomBytes } from 'crypto';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';

const PI_API_KEY = process.env.PODCASTINDEX_API_KEY;
const PI_API_SECRET = process.env.PODCASTINDEX_API_SECRET;

// Submit feed to Podcast Index and return PI ID if available
async function notifyPodcastIndex(feedUrl: string): Promise<number | null> {
  if (!PI_API_KEY || !PI_API_SECRET) return null;

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

    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.feed?.id) {
          return data.feed.id;
        }
      } catch {
        // JSON parse failed, ignore
      }
    }
  } catch {
    // Silent fail - don't block feed creation
  }
  return null;
}

// Look up existing feed's PI ID from Podcast Index by GUID
async function lookupPodcastIndexId(podcastGuid: string): Promise<number | null> {
  if (!PI_API_KEY || !PI_API_SECRET) return null;

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

    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(podcastGuid)}`, {
      headers
    });

    const text = await response.text();
    if (text) {
      try {
        const data = JSON.parse(text);
        if (data.feed?.id) {
          return data.feed.id;
        }
      } catch {
        // JSON parse failed, ignore
      }
    }
  } catch {
    // Silent fail
  }
  return null;
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
  // GET - List all feeds (admin only)
  if (req.method === 'GET') {
    // Check legacy admin key
    const adminKey = req.headers['x-admin-key'];
    const hasLegacyAdmin = process.env.MSP_ADMIN_KEY && adminKey === process.env.MSP_ADMIN_KEY;

    // Check Nostr auth header
    const authHeader = req.headers['authorization'] as string | undefined;
    const nostrAuth = await parseAuthHeader(authHeader);

    if (!hasLegacyAdmin && !nostrAuth.valid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const { blobs } = await list({ prefix: 'feeds/' });
      const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
      const xmlBlobs = blobs.filter(b => b.pathname.endsWith('.xml'));

      const feeds = await Promise.all(
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

          // Look up PI ID if missing and update metadata in background
          let podcastIndexId = meta.podcastIndexId;
          if (!podcastIndexId) {
            // feedId is the podcast GUID, use it to lookup on PI
            podcastIndexId = await lookupPodcastIndexId(feedId);
            if (podcastIndexId) {
              // Update metadata with PI ID (don't await - fire and forget)
              put(`feeds/${feedId}.meta.json`, JSON.stringify({
                ...meta,
                podcastIndexId
              }), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false
              }).catch(() => {});
            }
          }

          return { feedId, author, ...meta, podcastIndexId };
        })
      );

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

    // Build stable URL
    const stableUrl = `${getBaseUrl(req)}/api/hosted/${feedId}.xml`;

    // Notify Podcast Index and get PI ID
    const podcastIndexId = await notifyPodcastIndex(stableUrl);

    // Store metadata separately (Vercel Blob doesn't support custom metadata)
    await put(`feeds/${feedId}.meta.json`, JSON.stringify({
      editTokenHash,
      createdAt: Date.now().toString(),
      title: (typeof title === 'string' ? title : 'Untitled Feed').slice(0, 200),
      ownerPubkey,
      linkedAt,
      podcastIndexId
    }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    return res.status(201).json({
      feedId,
      editToken, // Only returned once at creation!
      url: stableUrl,
      blobUrl: blob.url,
      podcastIndexId
    });
  } catch (error) {
    console.error('Error creating hosted feed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create feed';
    return res.status(500).json({ error: message });
  }
}
