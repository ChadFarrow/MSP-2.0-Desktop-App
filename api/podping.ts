import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notifyPodping } from './_utils/feedUtils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = req.method === 'GET' ? req.query : req.body ?? {};
  const { url, reason, medium } = source as {
    url?: string;
    reason?: string;
    medium?: string;
  };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  if (!process.env.PODPING_TOKEN) {
    return res.status(501).json({ error: 'PODPING_TOKEN not configured' });
  }

  const result = await notifyPodping(url, { reason, medium });
  if (!result.ok) {
    return res.status(result.status ?? 502).json({
      error: result.error ?? 'Podping submission failed'
    });
  }

  return res.status(200).json({ success: true });
}
