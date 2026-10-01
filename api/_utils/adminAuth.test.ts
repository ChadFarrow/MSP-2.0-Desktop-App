import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { isChartViewerPubkey, parseChartAuthHeader } from './adminAuth.js';

function key() {
  const secret = generateSecretKey();
  return { secret, hex: getPublicKey(secret) };
}

/** A NIP-98 Authorization header, as the /charts page sends it. */
function header(secret: Uint8Array, createdAt = Math.floor(Date.now() / 1000)): string {
  const event = finalizeEvent({
    kind: 27235,
    created_at: createdAt,
    tags: [['u', 'https://musicsideproject.com/api/boosts/chart'], ['method', 'GET']],
    content: ''
  }, secret);
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
}

const admin = key();
const viewer = key();
const stranger = key();

describe('isChartViewerPubkey', () => {
  afterEach(() => { delete process.env.MSP_CHART_PUBKEYS; });

  it('accepts a key listed as an npub, which is what people share', () => {
    process.env.MSP_CHART_PUBKEYS = nip19.npubEncode(viewer.hex);
    expect(isChartViewerPubkey(viewer.hex)).toBe(true);
  });

  it('accepts a key listed as hex, in either case', () => {
    process.env.MSP_CHART_PUBKEYS = viewer.hex.toUpperCase();
    expect(isChartViewerPubkey(viewer.hex)).toBe(true);
  });

  it('reads a comma-separated list with spaces around the entries', () => {
    process.env.MSP_CHART_PUBKEYS = ` ${stranger.hex.slice(0, 10)} , ${nip19.npubEncode(viewer.hex)} ,`;
    expect(isChartViewerPubkey(viewer.hex)).toBe(true);
  });

  it('refuses a key that is not listed, and everyone when the list is unset', () => {
    process.env.MSP_CHART_PUBKEYS = nip19.npubEncode(viewer.hex);
    expect(isChartViewerPubkey(stranger.hex)).toBe(false);
    delete process.env.MSP_CHART_PUBKEYS;
    expect(isChartViewerPubkey(viewer.hex)).toBe(false);
  });

  it('skips an entry it cannot read rather than failing the whole list', () => {
    process.env.MSP_CHART_PUBKEYS = `npub1notreal,${viewer.hex}`;
    expect(isChartViewerPubkey(viewer.hex)).toBe(true);
  });
});

describe('parseChartAuthHeader', () => {
  beforeEach(() => {
    process.env.MSP_ADMIN_PUBKEYS = admin.hex;
    process.env.MSP_CHART_PUBKEYS = nip19.npubEncode(viewer.hex);
  });
  afterEach(() => {
    delete process.env.MSP_ADMIN_PUBKEYS;
    delete process.env.MSP_CHART_PUBKEYS;
  });

  it('lets a chart viewer in', async () => {
    expect(await parseChartAuthHeader(header(viewer.secret))).toMatchObject({ valid: true, pubkey: viewer.hex });
  });

  it('lets an admin in', async () => {
    expect((await parseChartAuthHeader(header(admin.secret))).valid).toBe(true);
  });

  it('refuses a correctly signed key on neither list', async () => {
    expect((await parseChartAuthHeader(header(stranger.secret))).valid).toBe(false);
  });

  it('refuses an old event, so a captured header cannot be replayed', async () => {
    const stale = Math.floor(Date.now() / 1000) - 600;
    expect((await parseChartAuthHeader(header(viewer.secret, stale))).valid).toBe(false);
  });

  it("refuses an event claiming a viewer's key but signed by another", async () => {
    const forged = JSON.parse(Buffer.from(header(stranger.secret).slice(6), 'base64').toString());
    forged.pubkey = viewer.hex;
    const forgedHeader = `Nostr ${Buffer.from(JSON.stringify(forged)).toString('base64')}`;
    expect((await parseChartAuthHeader(forgedHeader)).valid).toBe(false);
  });

  it('refuses a missing or malformed header', async () => {
    expect((await parseChartAuthHeader(undefined)).valid).toBe(false);
    expect((await parseChartAuthHeader('Nostr not-base64-json')).valid).toBe(false);
  });
});
