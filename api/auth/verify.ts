import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, put } from '@vercel/blob';
import { signSession } from '../_utils/emailAuth.js';
import { redeemMagicLink, addFeedToAccount } from '../_utils/accountStore.js';

/**
 * Redeem a magic-link token (single-use) and mint a session.
 * For a 'claim' link, also stamps ownerEmailHash onto the feed and indexes it to the account.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = (req.body ?? {}) as { token?: string };
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  const record = await redeemMagicLink(token);
  if (!record) {
    return res.status(400).json({ error: 'This link is invalid or has expired. Request a new one.' });
  }

  // Claim links carry a feedId: attach the email as owner and index it to the account.
  if (record.purpose === 'claim' && record.feedId) {
    try {
      const path = `feeds/${record.feedId}.meta.json`;
      const { blobs } = await list({ prefix: path });
      const metaBlob = blobs.find(b => b.pathname === path);
      if (metaBlob) {
        const meta = await (await fetch(metaBlob.url)).json().catch(() => ({}));
        await put(path, JSON.stringify({
          ...meta,
          ownerEmailHash: record.emailHash,
          emailLinkedAt: Date.now().toString()
        }), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: true
        });
        await addFeedToAccount(record.emailHash, record.feedId);
      }
    } catch (err) {
      console.error('verify claim error:', err instanceof Error ? err.message : err);
      return res.status(500).json({ error: 'Failed to claim feed' });
    }
  }

  const session = signSession(record.emailHash);
  return res.status(200).json({ session, emailHash: record.emailHash });
}
