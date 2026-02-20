import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';
import { randomBytes } from 'crypto';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';
import {
  notifyPodcastIndex,
  lookupPodcastIndexId,
  getBaseUrl,
  hashToken,
  isValidFeedId
} from '../_utils/feedUtils.js';

// Generate a secure edit token
function generateEditToken(): string {
  return randomBytes(32).toString('base64url');
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
      const xmlBlobs = blobs.filter(b => b.pathname.endsWith('.xml') && !b.pathname.includes('.backup.'));

      let feeds = await Promise.all(
        metaBlobs.map(async (blob) => {
          const response = await fetch(blob.url);
          const text = await response.text();
          const meta = text ? JSON.parse(text) : {};
          const feedId = blob.pathname.replace('feeds/', '').replace('.meta.json', '');

          // Try to extract author and medium from the XML feed
          let author: string | undefined;
          let medium: string | undefined;
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
              // Extract podcast:medium using regex
              const mediumMatch = xml.match(/<podcast:medium>([^<]+)<\/podcast:medium>/);
              if (mediumMatch) {
                medium = mediumMatch[1];
              }
            } catch {
              // Ignore errors extracting metadata
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
              }).catch(err => console.warn('Failed to update metadata with PI ID:', err));
            }
          }

          return { feedId, author, medium, ...meta, podcastIndexId };
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
    if (!isValidFeedId(podcastGuid)) {
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

    // Check if feed already exists by looking for metadata file
    // (metadata is what defines a "managed" feed with credentials)
    const { blobs } = await list({ prefix: `feeds/${feedId}.meta.json` });
    const existingMeta = blobs.find(b => b.pathname === `feeds/${feedId}.meta.json`);
    if (existingMeta) {
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
    // allowOverwrite handles orphaned blobs from incomplete deletions
    const blob = await put(`feeds/${feedId}.xml`, xml, {
      access: 'public',
      contentType: 'application/rss+xml',
      addRandomSuffix: false,
      allowOverwrite: true
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
      addRandomSuffix: false,
      allowOverwrite: true
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
