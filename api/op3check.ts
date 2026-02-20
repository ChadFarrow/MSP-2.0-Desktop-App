import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Check if OP3 has stats for a given podcast GUID.
 * GET /api/op3check?guid=<podcast-guid>
 * Returns { hasStats: boolean }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { guid } = req.query;

  if (!guid || typeof guid !== 'string') {
    return res.status(400).json({ error: 'Missing guid parameter' });
  }

  // Basic UUID format validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)) {
    return res.status(400).json({ error: 'Invalid GUID format' });
  }

  try {
    const response = await fetch(`https://op3.dev/show/${guid}`, {
      method: 'HEAD',
      redirect: 'follow'
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    return res.status(200).json({ hasStats: response.ok });
  } catch (error) {
    console.error('OP3 check error:', error);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ hasStats: false });
  }
}
