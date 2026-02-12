import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, del, list } from '@vercel/blob';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';
import {
  notifyPodcastIndex,
  getBaseUrl,
  hashToken,
  isValidFeedId
} from '../_utils/feedUtils.js';

// Metadata stored in separate .meta.json blob
interface FeedMetadata {
  editTokenHash: string;
  createdAt: string;
  lastUpdated?: string;
  title?: string;
  ownerPubkey?: string;  // Nostr pubkey (hex) - if linked
  linkedAt?: string;     // When Nostr was linked
  podcastIndexId?: number;
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
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Helper to backup a feed and enforce retention (keep last 10)
async function backupFeed(feedId: string, blobUrl: string): Promise<void> {
  const response = await fetch(blobUrl);
  const xml = await response.text();
  if (!xml) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await put(`feeds/${feedId}.backup.${timestamp}.xml`, xml, {
    access: 'public',
    contentType: 'application/rss+xml',
    addRandomSuffix: false
  });

  // Enforce retention: keep only the 10 most recent backups
  const backupPrefix = `feeds/${feedId}.backup.`;
  const { blobs } = await list({ prefix: backupPrefix });
  const backups = blobs
    .filter(b => b.pathname.startsWith(backupPrefix) && b.pathname.endsWith('.xml'))
    .sort((a, b) => b.pathname.localeCompare(a.pathname)); // newest first (ISO timestamps sort lexically)

  if (backups.length > 10) {
    const toDelete = backups.slice(10);
    await Promise.all(toDelete.map(b => del(b.url)));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
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
        // List backups for this feed (admin only)
        if ('backups' in req.query) {
          if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
          }

          const backupPrefix = `feeds/${feedId}.backup.`;
          const { blobs: backupBlobs } = await list({ prefix: backupPrefix });
          const backups = backupBlobs
            .filter(b => b.pathname.startsWith(backupPrefix) && b.pathname.endsWith('.xml'))
            .map(b => {
              const timestampPart = b.pathname
                .replace(backupPrefix, '')
                .replace('.xml', '');
              return {
                timestamp: timestampPart,
                size: b.size,
                uploadedAt: b.uploadedAt
              };
            })
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(200).json({ feedId, backups, count: backups.length });
        }

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

      case 'POST': {
        // Restore feed from a backup (admin only)
        if (!isAdmin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { backup } = req.query;
        if (!backup || typeof backup !== 'string') {
          return res.status(400).json({ error: 'Missing backup timestamp query parameter' });
        }

        // Find the backup blob
        const backupPath = `feeds/${feedId}.backup.${backup}.xml`;
        const { blobs: backupBlobs } = await list({ prefix: backupPath });
        const backupBlob = backupBlobs.find(b => b.pathname === backupPath);

        if (!backupBlob) {
          return res.status(404).json({ error: 'Backup not found' });
        }

        // Fetch backup content
        const backupResponse = await fetch(backupBlob.url);
        const backupXml = await backupResponse.text();

        if (!backupXml) {
          return res.status(500).json({ error: 'Backup file is empty' });
        }

        // Save current feed as a backup before restoring (if it exists)
        const { blobs: currentBlobs } = await list({ prefix: blobPath });
        const currentBlob = currentBlobs.find(b => b.pathname === blobPath);
        if (currentBlob) {
          await backupFeed(feedId as string, currentBlob.url);
          await del(currentBlob.url);
        }

        // Write the backup content as the current feed
        await put(blobPath, backupXml, {
          access: 'public',
          contentType: 'application/rss+xml',
          addRandomSuffix: false
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json({ success: true, restored: backup });
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
        let existingPodcastIndexId: number | undefined;

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
          existingPodcastIndexId = undefined;
        } else {
          storedHash = metadata.editTokenHash;
          createdAt = metadata.createdAt;
          existingTitle = metadata.title;
          ownerPubkey = metadata.ownerPubkey;
          linkedAt = metadata.linkedAt;
          existingPodcastIndexId = metadata.podcastIndexId;

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

        // Save a backup copy of the current feed before overwriting
        await backupFeed(feedId as string, existingBlob.url);

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

        // Notify Podcast Index and get PI ID (may update existing ID)
        const stableUrl = `${getBaseUrl(req)}/api/hosted/${feedId}.xml`;
        const newPodcastIndexId = await notifyPodcastIndex(stableUrl);
        const podcastIndexId = newPodcastIndexId || existingPodcastIndexId;

        await put(metaPath, JSON.stringify({
          editTokenHash: storedHash,
          createdAt,
          lastUpdated: Date.now().toString(),
          title: (typeof title === 'string' ? title : existingTitle || 'Untitled Feed').slice(0, 200),
          ownerPubkey,
          linkedAt,
          podcastIndexId
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        return res.status(200).json({ success: true, podcastIndexId });
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

        // Save a backup copy before deleting
        await backupFeed(feedId as string, existingBlob.url);

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
