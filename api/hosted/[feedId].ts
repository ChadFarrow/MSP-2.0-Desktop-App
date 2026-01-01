import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, head, del, list } from '@vercel/blob';
import { createHash } from 'crypto';

// Hash token for comparison
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Validate feedId format (12-char nanoid)
function isValidFeedId(feedId: string): boolean {
  return /^[a-zA-Z0-9_-]{12}$/.test(feedId);
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

        // Get existing blob to verify token
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Get blob metadata using head
        const blobInfo = await head(existingBlob.url);
        if (!blobInfo) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Verify token
        const storedHash = blobInfo.metadata?.editTokenHash;
        if (!storedHash) {
          return res.status(500).json({ error: 'Feed metadata corrupted' });
        }

        const providedHash = hashToken(editToken);
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

        // Delete old blob first (Vercel Blob doesn't support true update)
        await del(existingBlob.url);

        // Store updated content with same metadata
        await put(blobPath, xml, {
          access: 'public',
          contentType: 'application/rss+xml',
          addRandomSuffix: false,
          metadata: {
            editTokenHash: storedHash,
            createdAt: blobInfo.metadata?.createdAt || Date.now().toString(),
            lastUpdated: Date.now().toString(),
            title: (typeof title === 'string' ? title : blobInfo.metadata?.title || 'Untitled Feed').slice(0, 200)
          }
        });

        return res.status(200).json({ success: true });
      }

      case 'DELETE': {
        // Validate edit token
        const editToken = req.headers['x-edit-token'];
        if (!editToken || typeof editToken !== 'string') {
          return res.status(401).json({ error: 'Missing edit token' });
        }

        // Get existing blob
        const { blobs } = await list({ prefix: blobPath });
        const existingBlob = blobs.find(b => b.pathname === blobPath);

        if (!existingBlob) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Get blob metadata to verify token
        const blobInfo = await head(existingBlob.url);
        if (!blobInfo) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Verify token
        const storedHash = blobInfo.metadata?.editTokenHash;
        if (!storedHash) {
          return res.status(500).json({ error: 'Feed metadata corrupted' });
        }

        const providedHash = hashToken(editToken);
        if (storedHash !== providedHash) {
          return res.status(403).json({ error: 'Invalid edit token' });
        }

        // Delete the blob
        await del(existingBlob.url);

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
