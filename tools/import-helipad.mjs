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
 *   node tools/import-helipad.mjs [--from <index>] [--page 100] [--dry-run]
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

/** Must match MAX_BATCH in api/boosts/ingest.ts. */
const INGEST_BATCH = 200;

function parseArgs(argv) {
  const args = { page: 100, from: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--page') args.page = Number(argv[++i]);
    else if (argv[i] === '--from') args.from = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(args.page) || args.page < 1 || args.page > 500) {
    throw new Error('--page must be between 1 and 500');
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
    body: JSON.stringify({ password, stay_logged_in: true })
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

  let cursor = args.from;
  if (cursor === null) {
    cursor = unwrapNumber(await getJson(`${baseUrl}/api/v1/index`, headers), 'newest index');
  }
  console.log(`Walking backwards from index ${cursor}, ${args.page} at a time`);

  let pending = [];
  const totals = { fetched: 0, written: 0, duplicates: 0, skipped: 0 };

  const flush = async () => {
    while (pending.length) {
      const batch = pending.splice(0, INGEST_BATCH);
      if (args.dryRun) {
        console.log(`  [dry run] would post ${batch.length} records`);
        continue;
      }
      const result = await postBatch(ingestUrl, ingestToken, batch);
      totals.written += result.written ?? 0;
      totals.duplicates += result.duplicates ?? 0;
      totals.skipped += result.skipped ?? 0;
      console.log(`  posted ${batch.length}: ${result.written} new, ${result.duplicates} already stored`);
    }
  };

  while (cursor > 0) {
    const url = `${baseUrl}/api/v1/boosts?index=${cursor}&count=${args.page}&old=true`;
    const boosts = unwrapList(await getJson(url, headers), 'boosts');
    if (boosts.length === 0) break;

    totals.fetched += boosts.length;
    pending.push(...boosts);
    if (pending.length >= INGEST_BATCH) await flush();

    const lowest = Math.min(...boosts.map(b => Number(b.index)).filter(Number.isFinite));
    if (!Number.isFinite(lowest) || lowest <= 0) break;
    // Step past the oldest record in this page, or the walk repeats it forever.
    cursor = lowest - 1;
  }

  await flush();

  console.log(
    `\nDone. fetched ${totals.fetched}, stored ${totals.written} new, ` +
    `${totals.duplicates} already present, ${totals.skipped} unusable.`
  );
}

main().catch(error => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
