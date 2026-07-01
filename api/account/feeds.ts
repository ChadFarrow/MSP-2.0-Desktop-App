import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseEmailAuthHeader } from '../_utils/emailAuth.js';
import { getAccountFeedIds } from '../_utils/accountStore.js';
import { hydrateFeedById } from '../_utils/feedHydrate.js';

/**
 * List the feeds owned by the authenticated email account.
 * Auth: X-Email-Session: Bearer <jwt>. Returns the same feed shape as the Nostr list path.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const header = req.headers['x-email-session'];
  const auth = parseEmailAuthHeader(Array.isArray(header) ? header[0] : header);
  if (!auth.valid || !auth.emailHash) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const feedIds = await getAccountFeedIds(auth.emailHash);
    const hydrated = await Promise.all(feedIds.map(id => hydrateFeedById(id)));
    const feeds = hydrated.filter(Boolean);
    return res.status(200).json({ feeds, count: feeds.length });
  } catch (err) {
    console.error('account feeds error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Failed to list feeds' });
  }
}
