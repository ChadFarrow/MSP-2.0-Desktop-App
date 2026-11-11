#!/usr/bin/env node
/**
 * Download the feed corpus that src/utils/feedCorpus.roundTrip.test.ts reads.
 *
 * The round-trip test is hermetic: it reads committed copies of real published feeds,
 * never the network. This script is the only thing that refreshes those copies. It
 * fetches each `url` in src/test/feed-corpus/manifest.json, writes the body next to
 * the manifest, and records `final_url`, `fetched_at`, `bytes` and `sha256`, so a
 * reviewer can see exactly which bytes a snapshot was taken against.
 *
 * The list of feeds came from musicindex-studio's round-trip corpus
 * (InTheMorning/musicindex-studio, crates/core/tests/corpus/manifest.json). Only the
 * URLs were taken; every file is fetched from its own publisher. Studio is AGPL-3.0
 * and this repo is MIT, so do not copy files from there.
 *
 * Usage:
 *   node tools/fetch-feed-corpus.mjs              # refresh every feed
 *   node tools/fetch-feed-corpus.mjs a.xml b.xml  # refresh only these files
 *   node tools/fetch-feed-corpus.mjs --add <file> <kind> <url>
 *
 * A refreshed feed usually changes what MSP keeps from it, so run
 * `npx vitest run src/utils/feedCorpus.roundTrip.test.ts -u` afterwards and read the
 * snapshot diff before committing it. A feed that has gone away stays in the corpus:
 * the committed copy is still a real feed MSP must handle.
 */
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(ROOT, 'src/test/feed-corpus');
const MANIFEST = join(CORPUS_DIR, 'manifest.json');

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'MSP-2.0-feed-corpus/1.0';
const FILE_NAME = /^[a-z0-9][a-z0-9.-]*\.xml$/;

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST, 'utf8'));
}

async function writeManifest(manifest) {
  const tmp = `${MANIFEST}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tmp, MANIFEST);
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new Error(`body is ${declared} bytes, over ${MAX_BYTES}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`body is ${body.length} bytes, over ${MAX_BYTES}`);
  // The test parses these as RSS. An HTML error page served with a 200 must not
  // land in the corpus looking like a feed.
  if (!/<rss[\s>]/.test(body.subarray(0, 4096).toString('utf8'))) {
    throw new Error('response has no <rss> element in its first 4 KB');
  }
  return { body, finalUrl: res.url };
}

async function refresh(entry) {
  if (!FILE_NAME.test(entry.file)) throw new Error(`bad file name ${JSON.stringify(entry.file)}`);
  const { body, finalUrl } = await fetchFeed(entry.url);
  const target = join(CORPUS_DIR, entry.file);
  await writeFile(`${target}.tmp`, body);
  await rename(`${target}.tmp`, target);
  entry.final_url = finalUrl;
  entry.fetched_at = new Date().toISOString();
  entry.bytes = body.length;
  entry.sha256 = createHash('sha256').update(body).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const manifest = await readManifest();

  if (args[0] === '--add') {
    const [, file, kind, url] = args;
    if (!file || !kind || !url) throw new Error('usage: --add <file> <kind> <url>');
    if (manifest.feeds.some((e) => e.file === file)) throw new Error(`${file} is already in the manifest`);
    manifest.feeds.push({ file, kind, url });
    args.splice(0, args.length, file);
  }

  const wanted = args.length ? new Set(args) : null;
  if (wanted) {
    const unknown = [...wanted].filter((f) => !manifest.feeds.some((e) => e.file === f));
    if (unknown.length) throw new Error(`not in the manifest: ${unknown.join(', ')}`);
  }

  let failed = 0;
  for (const entry of manifest.feeds) {
    if (wanted && !wanted.has(entry.file)) continue;
    try {
      await refresh(entry);
      console.log(`ok    ${entry.file}  ${entry.bytes} bytes`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${entry.file}  ${err instanceof Error ? err.message : String(err)}  (${entry.url})`);
    }
  }
  await writeManifest(manifest);
  if (failed) {
    console.log(`\n${failed} feed(s) not refreshed. Their committed copies, if any, are unchanged.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
