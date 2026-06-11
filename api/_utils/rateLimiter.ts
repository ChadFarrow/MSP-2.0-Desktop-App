import type { VercelRequest } from '@vercel/node';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterMs: 0 };
  }

  if (bucket.count >= options.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: options.limit - bucket.count,
    retryAfterMs: 0
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0].trim();
  return first.length > 0 ? first : null;
}

/**
 * Client IP for rate-limit keys. Prefers headers set by Vercel's proxy
 * (x-vercel-forwarded-for, x-real-ip), which clients cannot spoof, over
 * x-forwarded-for, which clients can prepend arbitrary values to.
 */
export function getClientIp(req: VercelRequest): string {
  return (
    firstHeaderValue(req.headers['x-vercel-forwarded-for']) ??
    firstHeaderValue(req.headers['x-real-ip']) ??
    firstHeaderValue(req.headers['x-forwarded-for']) ??
    'unknown'
  );
}

/** Test-only — clears all buckets. Do not call from production code. */
export function __resetRateLimiterForTests(): void {
  buckets.clear();
}
