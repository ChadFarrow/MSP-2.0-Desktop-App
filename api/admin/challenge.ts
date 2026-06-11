import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateChallenge } from '../_utils/adminAuth.js';
import { applyCors } from '../_utils/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { challenge, expiresAt } = generateChallenge();

  return res.status(200).json({ challenge, expiresAt });
}
