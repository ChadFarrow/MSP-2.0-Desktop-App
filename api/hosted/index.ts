import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import { createHash, randomBytes } from 'crypto';

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
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { xml, title } = req.body;

    // Validate input
    if (!xml || typeof xml !== 'string') {
      return res.status(400).json({ error: 'Missing XML content' });
    }

    // Basic XML validation
    if (!xml.trim().startsWith('<?xml') && !xml.trim().startsWith('<rss')) {
      return res.status(400).json({ error: 'Invalid XML format' });
    }

    // Size limit: 1MB
    if (xml.length > 1024 * 1024) {
      return res.status(400).json({ error: 'XML content too large (max 1MB)' });
    }

    // Generate IDs
    const feedId = nanoid(12);
    const editToken = generateEditToken();
    const editTokenHash = hashToken(editToken);

    // Store in Vercel Blob
    const blob = await put(`feeds/${feedId}.xml`, xml, {
      access: 'public',
      contentType: 'application/rss+xml',
      addRandomSuffix: false,
      metadata: {
        editTokenHash,
        createdAt: Date.now().toString(),
        title: (typeof title === 'string' ? title : 'Untitled Feed').slice(0, 200)
      }
    });

    // Build stable URL
    const stableUrl = `${getBaseUrl(req)}/api/hosted/${feedId}`;

    return res.status(201).json({
      feedId,
      editToken, // Only returned once at creation!
      url: stableUrl,
      blobUrl: blob.url
    });
  } catch (error) {
    console.error('Error creating hosted feed:', error);
    const message = error instanceof Error ? error.message : 'Failed to create feed';
    return res.status(500).json({ error: message });
  }
}
