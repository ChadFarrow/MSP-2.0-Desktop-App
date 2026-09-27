// One-off: move the weekly chart files under MSP_BOOST_NAMESPACE
// (docs/superpowers/specs/2026-09-26-msp-bot-boost-ingest-design.md, section 4).
//
//   node tools/migrate-derived-to-namespace.mjs               rebuild every week, compare
//   node tools/migrate-derived-to-namespace.mjs --delete-old  ...then delete the old public files
//
// Needs BLOB_READ_WRITE_TOKEN (to list and delete) and MSP_ADMIN_KEY (to call the
// deployed /api/boosts/rebuild), from the environment or from the file named by ENVFILE.
// Prints neither. Run it only after the namespaced-path code is deployed.
import { list, del } from '@vercel/blob';
import { readFileSync } from 'node:fs';

const BASE = process.env.MSP_BASE_URL || 'https://musicsideproject.com';
// Weeks wholly before the cutover must match exactly; later weeks lose Helipad's
// post-cutover records until msp-bot's backfill runs.
const CUTOVER_WEEK = '2026-W05';
const OLD = /^boosts\/derived\/(\d{4}-W\d{2})\.json$/;

if (process.env.ENVFILE) {
  for (const line of readFileSync(process.env.ENVFILE, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
const adminKey = process.env.MSP_ADMIN_KEY;
if (!token || !adminKey) {
  console.error('BLOB_READ_WRITE_TOKEN and MSP_ADMIN_KEY are both required');
  process.exit(1);
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, token });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const old = (await listAll('boosts/derived/'))
  .filter(b => OLD.test(b.pathname))
  .sort((a, b) => a.pathname.localeCompare(b.pathname));
console.log(`old public weekly files: ${old.length}`);

let mismatches = 0;
for (const blob of old) {
  const week = OLD.exec(blob.pathname)[1];
  const oldCount = (await (await fetch(blob.url)).json()).length;
  const res = await fetch(`${BASE}/api/boosts/rebuild?week=${week}`, { headers: { 'x-admin-key': adminKey } });
  if (!res.ok) {
    console.error(`${week}: rebuild failed with ${res.status}; stopping`);
    process.exit(1);
  }
  const newCount = (await res.json()).rebuilt[week] ?? 0;
  const comparable = week < CUTOVER_WEEK;
  const mismatch = comparable && newCount !== oldCount;
  if (mismatch) mismatches += 1;
  console.log(`${week}  old ${oldCount}  new ${newCount}` +
    (comparable ? '' : '  (after the cutover: fills in after the bot backfill)') +
    (mismatch ? '  <-- MISMATCH' : ''));
}

if (mismatches > 0) {
  console.error(`${mismatches} week(s) before the cutover differ; deleting nothing`);
  process.exit(1);
}
if (process.argv.includes('--delete-old')) {
  await del(old.map(b => b.url), { token });
  console.log(`deleted ${old.length} old public weekly files`);
} else {
  console.log('checks passed; run again with --delete-old to delete the old public files');
}
