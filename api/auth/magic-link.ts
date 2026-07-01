import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import { normalizeEmail, emailHash } from '../_utils/emailAuth.js';
import { storeMagicLink, type MagicLinkPurpose } from '../_utils/accountStore.js';
import { sendMagicLinkEmail } from '../_utils/sendEmail.js';
import { getBaseUrl, hashToken, timingSafeEqualHex, isValidFeedId } from '../_utils/feedUtils.js';
import { checkRateLimit } from '../_utils/rateLimiter.js';

// Basic shape check — real validation is "can you receive the email".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw?.split(',')[0] || 'unknown').trim();
}

function magicLinkTtlMs(): number {
  const min = Number(process.env.MSP_MAGIC_LINK_TTL_MIN) || 15;
  return min * 60 * 1000;
}

/**
 * Origin to send the user back to. A magic link should return you to the site you're
 * actually using (the canonical domain in prod, or a Vercel preview during testing) —
 * NOT a hardcoded domain. The host is allowlisted (canonical host or a *.vercel.app
 * preview) to prevent host-header injection pointing the link at an attacker domain;
 * anything else falls back to the canonical URL.
 */
function getVerifyOrigin(req: VercelRequest): string {
  const canonical = getBaseUrl();
  const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
  const host = (Array.isArray(rawHost) ? rawHost[0] : rawHost)?.split(',')[0]?.trim();
  if (host) {
    const canonicalHost = new URL(canonical).host;
    if (host === canonicalHost || host.endsWith('.vercel.app')) {
      const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'https';
      return `${proto}://${host}`;
    }
  }
  return canonical;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, purpose, feedId, editToken } = (req.body ?? {}) as {
    email?: string;
    purpose?: MagicLinkPurpose;
    feedId?: string;
    editToken?: string;
  };

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const resolvedPurpose: MagicLinkPurpose = purpose === 'claim' ? 'claim' : 'login';
  const normalized = normalizeEmail(email);
  const eHash = emailHash(normalized);

  // Rate limit by IP and by target email so neither can be abused.
  const ip = getClientIp(req);
  const ipLimit = checkRateLimit(`magiclink:ip:${ip}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  const emailLimit = checkRateLimit(`magiclink:email:${eHash}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryAfterMs = Math.max(ipLimit.retryAfterMs, emailLimit.retryAfterMs);
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  let feedTitle: string | undefined;

  // For a claim, the requester must prove they currently own the feed (edit token),
  // otherwise anyone could attach their email to someone else's hosted feed.
  if (resolvedPurpose === 'claim') {
    if (!feedId || !isValidFeedId(feedId) || !editToken || typeof editToken !== 'string') {
      return res.status(400).json({ error: 'feedId and editToken required to claim a feed' });
    }
    const path = `feeds/${feedId}.meta.json`;
    const { blobs } = await list({ prefix: path });
    const metaBlob = blobs.find(b => b.pathname === path);
    if (!metaBlob) {
      return res.status(404).json({ error: 'Feed not found' });
    }
    const meta = await (await fetch(metaBlob.url)).json().catch(() => null) as { editTokenHash?: string; title?: string } | null;
    if (!meta?.editTokenHash || !timingSafeEqualHex(meta.editTokenHash, hashToken(editToken))) {
      return res.status(403).json({ error: 'Invalid edit token for this feed' });
    }
    feedTitle = meta.title;
  }

  try {
    const rawToken = await storeMagicLink({
      emailHash: eHash,
      purpose: resolvedPurpose,
      feedId: resolvedPurpose === 'claim' ? feedId : undefined,
      ttlMs: magicLinkTtlMs()
    });
    const link = `${getVerifyOrigin(req)}/auth/verify?token=${encodeURIComponent(rawToken)}`;
    await sendMagicLinkEmail(normalized, link, { purpose: resolvedPurpose, feedTitle });
  } catch (err) {
    console.error('magic-link error:', err instanceof Error ? err.message : err);
    // Fall through to the generic 200 below — never reveal internal/account state.
  }

  // Always 200 (no account enumeration). Whether or not the email exists/owns
  // anything, the response is identical.
  return res.status(200).json({ sent: true });
}
