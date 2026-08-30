import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseAuthHeader } from '../_utils/adminAuth.js';
import { timingSafeEqualString } from '../_utils/feedUtils.js';
import { isoWeekKey } from '../_utils/boostRecord.js';
import { isBoostStoreConfigured, rebuildWeekFromRaw } from '../_utils/boostStore.js';

/**
 * Keep the derived projection current without anyone running the importer.
 *
 * The webhook writes raw records continuously, so raw stays complete on its own — only
 * the derived week files go stale. This rebuilds them from raw, which needs no access to
 * Helipad, no machine on Chad's LAN, and nothing awake but Vercel.
 *
 * Raw is immutable, so reading it back through a CDN is always correct, and the week
 * file is written whole rather than merged. Those two properties are why this cannot
 * reintroduce the truncation bug that cost 2,200 records — there is no read-modify-write
 * anywhere in the path.
 *
 * **Two weeks, and only two.** A boost arriving just after midnight on Monday belongs to
 * the new week while the previous one can still take a late write. Nothing older can
 * change without an importer run, so scanning further back would be pure waste.
 */

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable is set. */
function isCronCaller(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers['authorization'];
  const presented = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7)
    : '';
  return !!presented && timingSafeEqualString(presented, secret);
}

function isLegacyAdmin(req: VercelRequest): boolean {
  const key = process.env.MSP_ADMIN_KEY;
  const presented = req.headers['x-admin-key'];
  return !!key && typeof presented === 'string' && timingSafeEqualString(presented, key);
}

/** The ISO week `weeksAgo` weeks before now. */
function recentWeek(weeksAgo: number): string {
  return isoWeekKey(Math.floor(Date.now() / 1000) - weeksAgo * 7 * 86400);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isBoostStoreConfigured()) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Three ways in, and no fourth. With CRON_SECRET unset the cron path simply cannot
  // authenticate — it never falls back to open, which is the failure mode that matters
  // for an endpoint that rewrites stored data.
  const authorized = isCronCaller(req)
    || isLegacyAdmin(req)
    || (await parseAuthHeader(req.headers['authorization'] as string | undefined)).valid;

  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const weeks = [recentWeek(0), recentWeek(1)];
    const rebuilt: Record<string, number | null> = {};
    for (const week of weeks) {
      rebuilt[week] = await rebuildWeekFromRaw(week);
    }
    return res.status(200).json({ ok: true, rebuilt });
  } catch (error) {
    console.error('Boost rebuild failed:', error);
    return res.status(500).json({ error: 'Rebuild failed' });
  }
}
