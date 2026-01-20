import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, del, list } from '@vercel/blob';
import { createHash } from 'crypto';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';

const PI_API_KEY = process.env.PODCASTINDEX_API_KEY;
const PI_API_SECRET = process.env.PODCASTINDEX_API_SECRET;

// Podcast Index notification result
interface PINotifyResult {
  success: boolean;
  message: string;
  podcastIndexId?: number;
}

// Notify Podcast Index to refresh feed and return result
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
      return {
        success: false,
        message: data.description || 'Podcast Index returned an error'
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to notify Podcast Index';
    return { success: false, message };
  }
}

// Get base URL from request
function getBaseUrl(req: VercelRequest): string {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

// Hash token for comparison
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Validate feedId format (UUID)
function isValidFeedId(feedId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(feedId);
}

// Metadata stored in separate .meta.json blob
interface FeedMetadata {
  editTokenHash: string;
  createdAt: string;
  lastUpdated?: string;
  title?: string;
  ownerPubkey?: string;  // Nostr pubkey (hex) - if linked
  linkedAt?: string;     // When Nostr was linked
}

// Helper to fetch metadata from .meta.json blob
async function getMetadata(feedId: string): Promise<FeedMetadata | null> {
  const metaPath = `feeds/${feedId}.meta.json`;
  const { blobs } = await list({ prefix: metaPath });
  const metaBlob = blobs.find(b => b.pathname === metaPath);

  if (!metaBlob) {
    return null;
  }

  const response = await fetch(metaBlob.url);
  return response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Edit-Token, Authorization, X-Admin-Key');
    return res.status(204).end();
  }

  let { feedId } = req.query;

  // Strip .xml extension if present (support both /guid and /guid.xml)
  if (typeof feedId === 'string' && feedId.endsWith('.xml')) {
    feedId = feedId.slice(0, -4);
  }

  // Check for admin key (bypasses UUID validation and edit token)
  const adminKey = req.headers['x-admin-key'];
  const hasLegacyAdmin = process.env.MSP_ADMIN_KEY && adminKey === process.env.MSP_ADMIN_KEY;

  // Check Nostr auth header for admin access
  const authHeader = req.headers['authorization'] as string | undefined;
  const nostrAuth = await parseAuthHeader(authHeader);

  const isAdmin = hasLegacyAdmin || nostrAuth.valid;

  // Validate feedId (admin can use any format, regular users need UUID)
  if (typeof feedId !== 'string' || (!isAdmin && !isValidFeedId(feedId))) {
    return res.status(400).json({ error: 'Invalid feed ID' });
  }

  const blobPath = `feeds/${feedId}.xml`;

  try {
    switch (req.method) {
      case 'GET': {
        // List blobs to find the one with matching pathname
        const { blobs } = await list({ prefix: blobPath });
        const blob = blobs.find(b => b.pathname === blobPath);

        if (!blob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Fetch the blob content and return it directly with CORS headers
        // (redirect would fail CORS for cross-origin requests)
        const blobResponse = await fetch(blob.url);
        const content = await blobResponse.text();

        // Set cache and CORS headers
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('Content-Type', 'application/rss+xml');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

        return res.status(200).send(content);
      }

      case 'PUT': {
        // Get existing feed blob
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Get metadata from .meta.json
        const metadata = await getMetadata(feedId as string);

        // Auto-repair: if metadata is missing, require token to create it
        let storedHash: string;
        let createdAt: string;
        let existingTitle: string | undefined;
        let ownerPubkey: string | undefined;
        let linkedAt: string | undefined;

        const editToken = req.headers['x-edit-token'];
        const authHeader = req.headers['authorization'] as string | undefined;

        if (!metadata) {
          // Legacy feed without metadata - require token to migrate
          if (!editToken || typeof editToken !== 'string') {
            return res.status(401).json({ error: 'Missing edit token' });
          }
          storedHash = hashToken(editToken);
          createdAt = Date.now().toString();
          existingTitle = undefined;
          ownerPubkey = undefined;
          linkedAt = undefined;
        } else {
          storedHash = metadata.editTokenHash;
          createdAt = metadata.createdAt;
          existingTitle = metadata.title;
          ownerPubkey = metadata.ownerPubkey;
          linkedAt = metadata.linkedAt;

          // Validate auth: accept either token or Nostr (if linked)
          let isAuthorized = false;

          // Try token auth first
          if (editToken && typeof editToken === 'string') {
            const providedHash = hashToken(editToken);
            if (storedHash === providedHash) {
              isAuthorized = true;
            }
          }

          // Try Nostr auth if token didn't work and feed has owner
          if (!isAuthorized && ownerPubkey && authHeader?.startsWith('Nostr ')) {
            const nostrAuth = await parseFeedAuthHeader(authHeader);
            if (nostrAuth.valid && nostrAuth.pubkey === ownerPubkey) {
              isAuthorized = true;
            }
          }

          if (!isAuthorized) {
            return res.status(403).json({ error: 'Invalid credentials' });
          }
        }

        // Parse request body
        const { xml, title } = req.body;

        if (!xml || typeof xml !== 'string') {
          return res.status(400).json({ error: 'Missing XML content' });
        }

        // Size limit
        if (xml.length > 1024 * 1024) {
          return res.status(400).json({ error: 'XML content too large (max 1MB)' });
        }

        // Delete old feed blob
        await del(existingBlob.url);

        // Store updated feed content
        await put(blobPath, xml, {
          access: 'public',
          contentType: 'application/rss+xml',
          addRandomSuffix: false
        });

        // Update/create metadata blob
        const metaPath = `feeds/${feedId}.meta.json`;
        const { blobs: metaBlobs } = await list({ prefix: metaPath });
        const existingMeta = metaBlobs.find(b => b.pathname === metaPath);
        if (existingMeta) {
          await del(existingMeta.url);
        }

        await put(metaPath, JSON.stringify({
          editTokenHash: storedHash,
          createdAt,
          lastUpdated: Date.now().toString(),
          title: (typeof title === 'string' ? title : existingTitle || 'Untitled Feed').slice(0, 200),
          ownerPubkey,
          linkedAt
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        // Notify Podcast Index to refresh and get result
        const stableUrl = `${getBaseUrl(req)}/api/hosted/${feedId}.xml`;
        const piResult = await notifyPodcastIndex(stableUrl);

        return res.status(200).json({ success: true, podcastIndex: piResult });
      }

      case 'PATCH': {
        // Link Nostr identity to existing feed
        // Requires BOTH token (proves ownership) AND Nostr auth (identity to link)
        const editToken = req.headers['x-edit-token'];
        const authHeader = req.headers['authorization'] as string | undefined;

        if (!editToken || typeof editToken !== 'string') {
          return res.status(401).json({ error: 'Edit token required to link Nostr identity' });
        }

        const metadata = await getMetadata(feedId as string);
        if (!metadata) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Validate token
        const providedHash = hashToken(editToken);
        if (metadata.editTokenHash !== providedHash) {
          return res.status(403).json({ error: 'Invalid edit token' });
        }

        // Parse and validate Nostr auth
        const nostrAuth = await parseFeedAuthHeader(authHeader);
        if (!nostrAuth.valid || !nostrAuth.pubkey) {
          return res.status(400).json({ error: nostrAuth.error || 'Invalid Nostr authentication' });
        }

        // Update metadata with new owner
        const metaPath = `feeds/${feedId}.meta.json`;
        const { blobs: metaBlobs } = await list({ prefix: metaPath });
        const existingMeta = metaBlobs.find(b => b.pathname === metaPath);
        if (existingMeta) {
          await del(existingMeta.url);
        }

        await put(metaPath, JSON.stringify({
          ...metadata,
          ownerPubkey: nostrAuth.pubkey,
          linkedAt: Date.now().toString()
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        return res.status(200).json({
          success: true,
          message: 'Nostr identity linked successfully',
          pubkey: nostrAuth.pubkey
        });
      }

      case 'DELETE': {
        // Admin can delete without edit token
        if (!isAdmin) {
          // Validate edit token for non-admin
          const editToken = req.headers['x-edit-token'];
          if (!editToken || typeof editToken !== 'string') {
            return res.status(401).json({ error: 'Missing edit token' });
          }

          // Get metadata from .meta.json
          const metadata = await getMetadata(feedId as string);
          const providedHash = hashToken(editToken);

          // For legacy feeds without metadata, allow deletion with any token
          // (can't verify, but feed is unusable anyway)
          if (metadata) {
            if (metadata.editTokenHash !== providedHash) {
              return res.status(403).json({ error: 'Invalid edit token' });
            }
          }
        }

        // Get existing feed blob
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Delete feed blob
        await del(existingBlob.url);

        // Delete metadata blob if it exists
        const metaPath = `feeds/${feedId}.meta.json`;
        const { blobs: metaBlobs } = await list({ prefix: metaPath });
        const existingMeta = metaBlobs.find(b => b.pathname === metaPath);
        if (existingMeta) {
          await del(existingMeta.url);
        }

        return res.status(200).json({ success: true });
      }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error handling hosted feed:', error);
    const message = error instanceof Error ? error.message : 'Operation failed';
    return res.status(500).json({ error: message });
  }
}
