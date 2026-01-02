import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, del, list } from '@vercel/blob';
import { createHash } from 'crypto';

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
  const { feedId } = req.query;

  // Validate feedId
  if (typeof feedId !== 'string' || !isValidFeedId(feedId)) {
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

        // Set cache headers (5 minutes for CDN efficiency)
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('Content-Type', 'application/rss+xml');

        // Redirect to the blob URL for efficient delivery
        return res.redirect(302, blob.url);
      }

      case 'PUT': {
        // Validate edit token
        const editToken = req.headers['x-edit-token'];
        if (!editToken || typeof editToken !== 'string') {
          return res.status(401).json({ error: 'Missing edit token' });
        }

        // Get existing feed blob
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Get metadata from .meta.json
        const metadata = await getMetadata(feedId as string);
        const providedHash = hashToken(editToken);

        // Auto-repair: if metadata is missing, create it using provided token
        // This handles feeds created before metadata was stored separately
        let storedHash: string;
        let createdAt: string;
        let existingTitle: string | undefined;

        if (!metadata) {
          // Migration: create metadata for legacy feed
          storedHash = providedHash;
          createdAt = Date.now().toString();
          existingTitle = undefined;
        } else {
          storedHash = metadata.editTokenHash;
          createdAt = metadata.createdAt;
          existingTitle = metadata.title;
        }

        // Verify token
        if (storedHash !== providedHash) {
          return res.status(403).json({ error: 'Invalid edit token' });
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
          title: (typeof title === 'string' ? title : existingTitle || 'Untitled Feed').slice(0, 200)
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        return res.status(200).json({ success: true });
      }

      case 'DELETE': {
        // Validate edit token
        const editToken = req.headers['x-edit-token'];
        if (!editToken || typeof editToken !== 'string') {
          return res.status(401).json({ error: 'Missing edit token' });
        }

        // Get existing feed blob
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
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
