import type { VercelRequest, VercelResponse } from '@vercel/node';
import { notifyPodping, isPodpingConfigured } from './_utils/feedUtils.js';
import { checkRateLimit } from './_utils/rateLimiter.js';
import { getFeedUrlError, normalizeFeedUrl } from './_utils/urlValidation.js';
import { getClientIp } from './_utils/urlSafety.js';
import { guardFeedSubmission, wantsForce } from './_utils/feedReachability.js';
import { applyCors } from './_utils/cors.js';

const RATE_LIMIT = { limit: 10, windowMs: 3600_000 };
// The limiter is one shared Map keyed by plain strings, so every endpoint
// namespaces its own. See _utils/rateLimiter.ts.
const RATE_LIMIT_PREFIX = 'podping:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = req.method === 'GET' ? req.query : req.body ?? {};
  const { url: rawUrl, reason, medium, force } = source as {
    url?: string;
    reason?: string;
    medium?: string;
    force?: unknown;
  };

  if (!rawUrl || typeof rawUrl !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Strip paste whitespace before validating — see the note in pubnotify.ts.
  const url = normalizeFeedUrl(rawUrl);
  if (!url) {
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
  const rate = checkRateLimit(`${RATE_LIMIT_PREFIX}${ip}`, RATE_LIMIT);
  if (!rate.allowed) {
    res.setHeader('Retry-After', Math.ceil(rate.retryAfterMs / 1000));
    return res.status(429).json({ error: 'Too many podping requests. Try again later.' });
  }

  if (!isPodpingConfigured()) {
    return res.status(501).json({ error: 'Podping not configured on this deployment' });
  }

  // A podping for an unfetchable feed is worse than useless: it lands on Hive,
  // every indexer dutifully goes to crawl, they all get the same 403 — and the
  // user sees "✅ Podping received" and assumes it worked. Checked after the
  // config gate so an unconfigured deployment never probes for nothing.
  const refusal = await guardFeedSubmission(url, { force: wantsForce(force), clientIp: ip });
  if (refusal) {
    return res.status(400).json(refusal);
  }

  const result = await notifyPodping(url, { reason, medium });
  if (!result.ok) {
    return res.status(result.status ?? 502).json({
      error: result.error ?? 'Podping submission failed'
    });
  }

  return res.status(200).json({ success: true });
}
