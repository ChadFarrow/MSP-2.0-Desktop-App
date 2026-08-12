import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHeaders } from './_utils/podcastIndex.js';
import { getFeedUrlError, normalizeFeedUrl } from './_utils/urlValidation.js';
import { guardFeedSubmission, wantsForce } from './_utils/feedReachability.js';
import { getClientIp } from './_utils/urlSafety.js';
import { applyCors } from './_utils/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'POST, OPTIONS' })) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url: rawUrl, force } = req.body;

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

  // See /api/pubnotify — same guard, so no client path can register an
  // unreachable feed regardless of which endpoint it goes through. Checked
  // before the credentials error below: a refusal is about the user's feed and
  // tells them something they can act on, where a missing key is our problem.
  const refusal = await guardFeedSubmission(url, { force: wantsForce(force), clientIp: getClientIp(req) });
  if (refusal) {
    return res.status(400).json(refusal);
  }

  const authHeaders = getAuthHeaders();
  if (!authHeaders) {
    return res.status(500).json({ error: 'API credentials not configured' });
  }

  try {
    const submitUrl = `https://api.podcastindex.org/api/1.0/add/byfeedurl?url=${encodeURIComponent(url)}`;

    const response = await fetch(submitUrl, {
      method: 'POST',
      headers: authHeaders
    });
    const data = await response.json();

    // Podcast Index returns status in the response body
    if (data.status === 'false' || data.status === false) {
      return res.status(400).json({
        error: data.description || 'Submit failed',
        details: data
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.description || 'Submit failed',
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      message: data.description || 'Feed submitted successfully',
      feedId: data.feedId || data.feed?.id
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to submit to Podcast Index',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
