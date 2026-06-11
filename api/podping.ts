import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notifyPodping, isPodpingConfigured } from './_utils/feedUtils.js';
import { checkRateLimit, getClientIp } from './_utils/rateLimiter.js';
import { getFeedUrlError } from './_utils/urlValidation.js';
import { applyCors } from './_utils/cors.js';

const RATE_LIMIT = { limit: 10, windowMs: 3600_000 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

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

  const urlError = getFeedUrlError(url);
  if (urlError) {
    return res.status(400).json({ error: urlError });
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many podping requests. Try again later.' });
  }

  if (!isPodpingConfigured()) {
    return res.status(501).json({ error: 'Podping not configured on this deployment' });
  }

  const result = await notifyPodping(url, { reason, medium });
  if (!result.ok) {
    return res.status(result.status ?? 502).json({
      error: result.error ?? 'Podping submission failed'
    });
  }

  return res.status(200).json({ success: true });
}
