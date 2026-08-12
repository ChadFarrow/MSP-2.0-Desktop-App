import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, del, list } from '@vercel/blob';
import { parseAuthHeader, parseFeedAuthHeader } from '../_utils/adminAuth.js';
import {
  notifyPodcastIndex,
  getBaseUrl,
  hashToken,
  timingSafeEqualHex,
  isValidFeedId
} from '../_utils/feedUtils.js';
import type { PodcastIndexAddResult } from '../_utils/feedUtils.js';
import { extractPodcastMedium, isWellFormedRss } from '../_utils/xmlUtils.js';
import { applyCors } from '../_utils/cors.js';
import { parseEmailAuthHeader } from '../_utils/emailAuth.js';
import { addFeedToAccount, removeFeedFromAccount } from '../_utils/accountStore.js';

// Metadata stored in separate .meta.json blob
interface FeedMetadata {
  editTokenHash: string;
  createdAt: string;
  lastUpdated?: string;
  title?: string;
  ownerPubkey?: string;  // Nostr pubkey (hex) - if linked
  linkedAt?: string;     // When Nostr was linked
  ownerEmailHash?: string;   // Keyed HMAC of the owner email - if claimed via email
  emailLinkedAt?: string;    // When the email was linked
  podcastIndexId?: number;
  isDraft?: boolean;     // True when hosted without PI/podping notification
}

// True when the X-Email-Session header carries a valid session for this feed's email owner.
function emailSessionOwns(metadata: { ownerEmailHash?: string }, header: string | undefined): boolean {
  if (!metadata.ownerEmailHash || !header) return false;
  const auth = parseEmailAuthHeader(header);
  return auth.valid && auth.emailHash === metadata.ownerEmailHash;
}

/**
 * Authorize a write (PUT/DELETE) against a feed that HAS metadata. Accepts, in order:
 * a matching edit token, the linked Nostr owner, or the linked email owner. The legacy
 * no-metadata path is handled by callers. Single source of the write-auth ladder so
 * PUT and DELETE can't drift apart.
 */
async function isAuthorizedFeedWrite(
  metadata: FeedMetadata,
  creds: { editToken?: string | string[]; authHeader?: string; emailSessionHeader?: string }
): Promise<boolean> {
  const token = typeof creds.editToken === 'string' ? creds.editToken : undefined;
  if (token && timingSafeEqualHex(metadata.editTokenHash, hashToken(token))) {
    return true;
  }
  if (metadata.ownerPubkey && creds.authHeader?.startsWith('Nostr ')) {
    const nostrAuth = await parseFeedAuthHeader(creds.authHeader);
    if (nostrAuth.valid && nostrAuth.pubkey === metadata.ownerPubkey) return true;
  }
  return emailSessionOwns(metadata, creds.emailSessionHeader);
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
  // Restricted CORS for state-changing methods; the GET branch below
  // overrides with a public wildcard so feed XML stays world-fetchable.
  if (applyCors(req, res, {
    methods: 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    headers: 'Content-Type, X-Edit-Token, Authorization, X-Admin-Key, X-Email-Session'
  })) {
    return;
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
        // Legacy-host migration: feeds first hosted under msp.podtards.com were
        // submitted to Podcast Index with that URL. Return a literal 301 to the
        // canonical domain so apps/PI move the subscription. Exact-host match +
        // canonical target means musicsideproject.com / preview hosts never loop.
        const host = ((req.headers['x-forwarded-host'] || req.headers.host || '') as string).toLowerCase();
        if (host === 'msp.podtards.com') {
          res.setHeader('Location', `${getBaseUrl()}/api/hosted/${feedId}.xml`);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Access-Control-Allow-Origin', '*');
          return res.status(301).end();
        }

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

        // Set cache and CORS headers. application/xml (not application/rss+xml)
        // so browsers render the feed inline in a tab instead of downloading it;
        // podcast apps / Podcast Index parse either content-type the same.
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
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
        let ownerEmailHash: string | undefined;
        let emailLinkedAt: string | undefined;
        let existingPodcastIndexId: number | undefined;
        let existingIsDraft: boolean | undefined;

        const editToken = req.headers['x-edit-token'];
        const authHeader = req.headers['authorization'] as string | undefined;
        const emailSessionHeader = req.headers['x-email-session'] as string | undefined;

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
          ownerEmailHash = undefined;
          emailLinkedAt = undefined;
          existingPodcastIndexId = undefined;
          existingIsDraft = undefined;
        } else {
          storedHash = metadata.editTokenHash;
          createdAt = metadata.createdAt;
          existingTitle = metadata.title;
          ownerPubkey = metadata.ownerPubkey;
          linkedAt = metadata.linkedAt;
          ownerEmailHash = metadata.ownerEmailHash;
          emailLinkedAt = metadata.emailLinkedAt;
          existingPodcastIndexId = metadata.podcastIndexId;
          existingIsDraft = metadata.isDraft;

          // Accept a matching edit token, the Nostr owner, or the email-session owner.
          const isAuthorized = await isAuthorizedFeedWrite(metadata, { editToken, authHeader, emailSessionHeader });

          if (!isAuthorized) {
            return res.status(403).json({ error: 'Invalid credentials' });
          }
        }

        // Parse request body
        const { xml, title, isDraft } = req.body;

        if (!xml || typeof xml !== 'string') {
          return res.status(400).json({ error: 'Missing XML content' });
        }

        // Size limit (before validation — validation walks the whole document)
        if (xml.length > 1024 * 1024) {
          return res.status(400).json({ error: 'XML content too large (max 1MB)' });
        }

        if (!isWellFormedRss(xml)) {
          return res.status(400).json({ error: 'Invalid XML format' });
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

        // Determine effective draft status:
        // If the request explicitly sets isDraft, use that; otherwise fall back to existing value
        const effectiveIsDraft = isDraft !== undefined ? (isDraft === true) : (existingIsDraft === true);

        // Notify Podcast Index and get PI ID (may update existing ID)
        // Skip PI/podping when in draft mode
        const stableUrl = `${getBaseUrl()}/api/hosted/${feedId}.xml`;
        const medium = extractPodcastMedium(xml);
        let podcastIndexId: number | undefined;
        let addResult: PodcastIndexAddResult | undefined;
        if (!effectiveIsDraft) {
          const piResult = await notifyPodcastIndex(stableUrl, { medium });
          podcastIndexId = piResult.podcastIndexId || existingPodcastIndexId;
          // Only explain a failure when we ended up with no id at all — a feed that
          // was already registered keeps its existing id and needs no explanation.
          if (!podcastIndexId) addResult = piResult.addResult;
        } else {
          podcastIndexId = existingPodcastIndexId;
        }

        await put(metaPath, JSON.stringify({
          editTokenHash: storedHash,
          createdAt,
          lastUpdated: Date.now().toString(),
          title: (typeof title === 'string' ? title : existingTitle || 'Untitled Feed').slice(0, 200),
          ownerPubkey,
          linkedAt,
          ownerEmailHash,
          emailLinkedAt,
          podcastIndexId,
          ...(effectiveIsDraft && { isDraft: true })
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        return res.status(200).json({
          success: true,
          podcastIndexId,
          // Present only when PI declined to register the feed — lets the UI say why.
          ...(addResult ? { addResult } : {}),
          isDraft: effectiveIsDraft
        });
      }

      case 'PATCH': {
        // Claim an existing feed by linking an identity to it.
        // Requires the edit token (proves current ownership) PLUS the identity to attach:
        // either an email session (X-Email-Session) or a Nostr auth event (Authorization: Nostr).
        const editToken = req.headers['x-edit-token'];
        const authHeader = req.headers['authorization'] as string | undefined;
        const emailSessionHeader = req.headers['x-email-session'] as string | undefined;

        if (!editToken || typeof editToken !== 'string') {
          return res.status(401).json({ error: 'Edit token required to link an identity' });
        }

        const metadata = await getMetadata(feedId as string);
        if (!metadata) {
          return res.status(404).json({ error: 'Feed not found' });
        }

        // Validate token
        const providedHash = hashToken(editToken);
        if (!timingSafeEqualHex(metadata.editTokenHash, providedHash)) {
          return res.status(403).json({ error: 'Invalid edit token' });
        }

        // Determine which identity to attach. Email session takes precedence when present.
        let updatedMeta: FeedMetadata;
        let responseExtra: Record<string, unknown>;

        if (emailSessionHeader) {
          const emailAuth = parseEmailAuthHeader(emailSessionHeader);
          if (!emailAuth.valid || !emailAuth.emailHash) {
            return res.status(400).json({ error: emailAuth.error || 'Invalid email session' });
          }
          updatedMeta = {
            ...metadata,
            ownerEmailHash: emailAuth.emailHash,
            emailLinkedAt: Date.now().toString()
          };
          responseExtra = { message: 'Email identity linked successfully', emailLinked: true };
          await addFeedToAccount(emailAuth.emailHash, feedId as string);
        } else {
          const nostrAuth = await parseFeedAuthHeader(authHeader);
          if (!nostrAuth.valid || !nostrAuth.pubkey) {
            return res.status(400).json({ error: nostrAuth.error || 'Invalid Nostr authentication' });
          }
          updatedMeta = {
            ...metadata,
            ownerPubkey: nostrAuth.pubkey,
            linkedAt: Date.now().toString()
          };
          responseExtra = { message: 'Nostr identity linked successfully', pubkey: nostrAuth.pubkey };
        }

        // Update metadata with the new owner
        const metaPath = `feeds/${feedId}.meta.json`;
        const { blobs: metaBlobs } = await list({ prefix: metaPath });
        const existingMeta = metaBlobs.find(b => b.pathname === metaPath);
        if (existingMeta) {
          await del(existingMeta.url);
        }

        await put(metaPath, JSON.stringify(updatedMeta), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false
        });

        return res.status(200).json({ success: true, ...responseExtra });
      }

      case 'DELETE': {
        // Fetch metadata once so both the auth check and the account-index cleanup can use it.
        const metadata = await getMetadata(feedId as string);

        // Admin can delete without any feed credential
        if (!isAdmin) {
          const editToken = req.headers['x-edit-token'];
          const emailSessionHeader = req.headers['x-email-session'] as string | undefined;
          const hasTokenHeader = typeof editToken === 'string' && editToken.length > 0;
          const hasNostr = authHeader?.startsWith('Nostr ');
          const hasEmailSession = typeof emailSessionHeader === 'string' && emailSessionHeader.length > 0;

          if (!hasTokenHeader && !hasNostr && !hasEmailSession) {
            return res.status(401).json({ error: 'Missing credentials' });
          }

          // Legacy feeds without metadata can't be verified (unusable anyway) — any token deletes.
          // Otherwise: matching token, Nostr owner, or email-session owner (mirrors PUT).
          const authorized = metadata
            ? await isAuthorizedFeedWrite(metadata, { editToken, authHeader, emailSessionHeader })
            : hasTokenHeader;

          if (!authorized) {
            return res.status(403).json({ error: 'Invalid credentials' });
          }
        }

        // Drop the feed from its owner's account index (best-effort; email-claimed feeds only).
        if (metadata?.ownerEmailHash) {
          await removeFeedFromAccount(metadata.ownerEmailHash, feedId as string).catch(() => { /* best-effort */ });
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
    return res.status(500).json({ error: 'Operation failed' });
  }
}
