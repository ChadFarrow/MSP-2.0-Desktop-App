#!/usr/bin/env node
/**
 * Backfill and repair MSP's boost store from Helipad.
 *
 * Helipad's webhook only ever fires for boosts that arrive after you switch it on, and
 * it never retries a failed delivery (see api/boosts/ingest.ts). This script is
 * therefore two things at once: the only route to history, and the standing repair
 * tool for anything the webhook dropped. It is safe to re-run at any time — the raw
 * store deduplicates on Helipad's unique boost index, and the derived projection is
 * rebuilt from whatever is posted, so a re-run also re-derives history with the
 * current resolveTrack() logic.
 *
 * Do NOT use Helipad's /csv export for this. Its columns carry no `tlv`, no `url`, no
 * `guid` and no recipient `name`, so a CSV import could neither join a boost to a feed
 * nor tell an MSP split from a boost to one of Chad's own shows.
 *
 * Usage:
 *   HELIPAD_URL=http://localhost:2112 \
 *   HELIPAD_PASSWORD=... \
 *   MSP_INGEST_URL=https://musicsideproject.com/api/boosts/ingest \
 *   HELIPAD_WEBHOOK_TOKEN=... \
 *   node tools/import-helipad.mjs [--from <index>] [--page 100] [--batch 25] [--dry-run]
 */

const USAGE = `Backfill and repair MSP's boost store from Helipad.

Usage:
  HELIPAD_URL=http://localhost:2112 \\
  HELIPAD_PASSWORD=... \\
  MSP_INGEST_URL=https://musicsideproject.com/api/boosts/ingest \\
  HELIPAD_WEBHOOK_TOKEN=... \\
  node tools/import-helipad.mjs [--from <index>] [--page 100] [--dry-run]

Safe to re-run: the raw store deduplicates on Helipad's boost index, and the
derived projection is rebuilt from whatever is posted.`;

const REQUIRED = ['HELIPAD_URL', 'HELIPAD_PASSWORD', 'MSP_INGEST_URL', 'HELIPAD_WEBHOOK_TOKEN'];

/**
 * Records per POST. The endpoint caps this at 200, but each record is a separate blob
 * write and vercel.json sets no functions.maxDuration, so a 200-record batch can run
 * past the platform's default timeout. 25 keeps a request comfortably short; a timeout
 * is not fatal either way, since the store deduplicates and the walk is re-runnable.
 */
const DEFAULT_BATCH = 500;
const MAX_BATCH = 500;

function parseArgs(argv) {
  const args = { page: 100, from: null, dryRun: false, batch: DEFAULT_BATCH };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--page') args.page = Number(argv[++i]);
    else if (argv[i] === '--from') args.from = Number(argv[++i]);
    else if (argv[i] === '--batch') args.batch = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(args.page) || args.page < 1 || args.page > 500) {
    throw new Error('--page must be between 1 and 500');
  }
  if (!Number.isFinite(args.batch) || args.batch < 1 || args.batch > MAX_BATCH) {
    throw new Error(`--batch must be between 1 and ${MAX_BATCH}`);
  }
  return args;
}

/**
 * Log in and return the headers that authenticate subsequent calls.
 *
 * Helipad mints a JWT and returns it in a Set-Cookie header; whether it also puts the
 * token in the JSON body is not documented, so both are captured and both are sent.
 * Sending an extra header costs nothing and removes a guess from the critical path.
 */
async function login(baseUrl, password) {
  const response = await fetch(`${baseUrl}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // stay_logged_in is an Option<String> on Helipad, not a boolean — its handler only
    // checks .is_some(), so any string means yes. Sending true gets a 422.
    body: JSON.stringify({ password, stay_logged_in: 'on' })
  });

  if (!response.ok) {
    throw new Error(`Helipad login failed: ${response.status} ${await response.text()}`);
  }

  const headers = {};
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) headers.cookie = setCookie.split(';')[0];

  let body = null;
  try {
    body = await response.json();
  } catch {
    // A cookie-only login is fine.
  }
  const token = body && (body.token || body.jwt || body.access_token);
  if (token) headers.authorization = `Bearer ${token}`;

  if (!headers.cookie && !headers.authorization) {
    throw new Error('Helipad login returned neither a cookie nor a token');
  }
  return headers;
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Helipad may answer with a bare value or wrap it; accept either rather than assume. */
function unwrapNumber(value, label) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    for (const key of ['index', 'value', 'data']) {
      if (typeof value[key] === 'number') return value[key];
    }
  }
  throw new Error(`Could not read ${label} from: ${JSON.stringify(value).slice(0, 200)}`);
}

function unwrapList(value, label) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['boosts', 'data', 'items']) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  throw new Error(`Could not read ${label} from: ${JSON.stringify(value).slice(0, 200)}`);
}

async function postBatch(ingestUrl, token, batch) {
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(batch)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Ingest rejected batch: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

/** ISO-8601 week key, matching isoWeekKey() in api/_utils/boostRecord.ts. */
function isoWeek(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNumber = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNumber);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function postWeek(ingestUrl, token, week, records) {
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ week, records })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Ingest rejected ${week}: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const missing = REQUIRED.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const baseUrl = process.env.HELIPAD_URL.replace(/\/+$/, '');
  const ingestUrl = process.env.MSP_INGEST_URL;
  const ingestToken = process.env.HELIPAD_WEBHOOK_TOKEN;

  const headers = await login(baseUrl, process.env.HELIPAD_PASSWORD);
  console.log(`Logged in to ${baseUrl}`);

  const startIndex = args.from ?? unwrapNumber(
    await getJson(`${baseUrl}/api/v1/index`, headers), 'newest index'
  );

  /**
   * Walk one list backwards. Helipad keeps boosts and streams in two separate lists,
   * so both must be walked — streams are the play signal and are the larger of the two.
   * They share one LND invoice index space, so indexes never collide between them.
   */
  const walk = async (endpoint) => {
    const out = [];
    let cursor = startIndex;
    while (cursor > 0) {
      const url = `${baseUrl}/api/v1/${endpoint}?index=${cursor}&count=${args.page}&old=true`;
      const records = unwrapList(await getJson(url, headers), endpoint);
      if (records.length === 0) break;
      out.push(...records);
      const lowest = Math.min(...records.map(r => Number(r.index)).filter(Number.isFinite));
      if (!Number.isFinite(lowest) || lowest <= 0) break;
      // Step past the oldest record in this page, or the walk repeats it forever.
      cursor = lowest - 1;
    }
    console.log(`  ${endpoint}: ${out.length} records`);
    return out;
  };

  const all = [];
  for (const endpoint of ['boosts', 'streams']) {
    console.log(`\nWalking /api/v1/${endpoint} backwards from index ${startIndex}`);
    all.push(...await walk(endpoint));
  }

  /**
   * Post one whole ISO week at a time.
   *
   * The endpoint rewrites a week's derived file from exactly what it is sent, so it
   * must receive the complete week. That is what removes the read-modify-write cycle,
   * and with it a CDN cache that silently truncated weeks during earlier imports.
   */
  const byWeek = new Map();
  for (const record of all) {
    const week = isoWeek(Number(record.time));
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(record);
  }

  const weeks = [...byWeek.keys()].sort();
  console.log(`\n${all.length} records across ${weeks.length} weeks`);

  const totals = { written: 0, duplicates: 0, skipped: 0, stored: 0, oversized: [] };
  for (const week of weeks) {
    const records = byWeek.get(week);
    if (records.length > args.batch) {
      // Splitting would mean the second half overwrote the first. Refuse instead.
      totals.oversized.push(`${week} (${records.length})`);
      console.log(`  ${week}: SKIPPED, ${records.length} records exceeds --batch ${args.batch}`);
      continue;
    }
    if (args.dryRun) {
      console.log(`  [dry run] ${week}: would post ${records.length}`);
      continue;
    }
    const result = await postWeek(ingestUrl, ingestToken, week, records);
    totals.written += result.written ?? 0;
    totals.duplicates += result.duplicates ?? 0;
    totals.skipped += result.skipped ?? 0;
    totals.stored += result.weekSizes?.[week] ?? 0;
    console.log(`  ${week}: sent ${records.length}, stored ${result.weekSizes?.[week]}, ${result.written} new raw`);
  }

  console.log(
    `\nDone. fetched ${all.length}, raw ${totals.written} new / ${totals.duplicates} existing, ` +
    `derived ${totals.stored} stored, ${totals.skipped} unusable.`
  );
  if (totals.oversized.length) {
    console.log(`Weeks skipped for exceeding --batch: ${totals.oversized.join(', ')}`);
  }
  if (!args.dryRun && totals.stored !== all.length - totals.skipped) {
    console.log(`WARNING: stored ${totals.stored} but sent ${all.length - totals.skipped}. They should match.`);
  }
}

main().catch(error => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
