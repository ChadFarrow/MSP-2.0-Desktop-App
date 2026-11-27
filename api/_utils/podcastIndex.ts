// Shared Podcast Index API authentication
import crypto from 'crypto';
import { USER_AGENT } from './userAgent.js';

const API_KEY = process.env.PODCASTINDEX_API_KEY;
const API_SECRET = process.env.PODCASTINDEX_API_SECRET;

export function getAuthHeaders(): Record<string, string> | null {
  if (!API_KEY || !API_SECRET) return null;

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash('sha1')
    .update(API_KEY + API_SECRET + apiHeaderTime)
    .digest('hex');

  return {
    'X-Auth-Key': API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hash,
    'User-Agent': USER_AGENT
  };
}
