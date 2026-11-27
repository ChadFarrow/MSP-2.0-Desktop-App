/**
 * The one User-Agent that MSP's server code sends to other hosts: feed hosts
 * (proxy-feed, verify-feed-url), Podcast Index, the podping endpoint, OP3, the
 * Hive nodes and Resend. Browser code cannot set this header and is unchanged.
 *
 * Form: `<AppName>/<version> (+<link>)`. No email, no browser imitation.
 *
 * - APP_VERSION is the major.minor of package.json. The full version the app
 *   shows (0.1.<commit count - 255>) is computed by vite.config.ts at build time,
 *   and api/ functions cannot read it. userAgent.test.ts fails if package.json
 *   moves to a new major.minor and this line does not.
 * - APP_URL is fixed, not CANONICAL_URL: a preview deployment still names the
 *   public site.
 * - No imports on purpose. Every function imports this through podcastIndex.ts or
 *   feedUtils.ts, and tools/*.mjs import it with plain `node` (type stripping).
 */
export const APP_NAME = 'MusicSideProjectStudio';
export const APP_VERSION = '0.1';
export const APP_URL = 'https://musicsideproject.com';

export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (+${APP_URL})`;
