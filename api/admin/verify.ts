import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateAdminAuthEvent } from '../_utils/adminAuth.js';
import type { NostrEvent } from '../_utils/adminAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { signedEvent } = req.body as { signedEvent: NostrEvent };

    if (!signedEvent) {
      return res.status(400).json({ error: 'Missing signed event' });
    }

    // Validate the auth event (signature, timestamp, pubkey)
    // Security: signature proves key ownership, 5-min timestamp window prevents replay
    const result = await validateAdminAuthEvent(signedEvent);
    if (!result.valid) {
      return res.status(401).json({ error: result.error || 'Authentication failed' });
    }

    return res.status(200).json({ success: true, pubkey: signedEvent.pubkey });
  } catch (error) {
    console.error('Error verifying admin auth:', error);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
