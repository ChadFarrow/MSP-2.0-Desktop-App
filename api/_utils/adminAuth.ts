import { createHash, randomBytes, createHmac } from 'crypto';
import * as secp from '@noble/secp256k1';
import { nip19 } from 'nostr-tools';

// Configure @noble/secp256k1 v3 with Node.js crypto. sha256 takes exactly one
// message: 3.1 calls every hook as fn(a, b), so it gets a trailing undefined, and
// hashing that throws — which schnorr.verify reports as an invalid signature.
secp.hashes.sha256 = (msg: Uint8Array) => Uint8Array.from(createHash('sha256').update(msg).digest());
secp.hashes.hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const hmac = createHmac('sha256', key);
  for (const msg of msgs) hmac.update(msg);
  return Uint8Array.from(hmac.digest());
};

const { schnorr } = secp;

// Nostr event structure
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Generate a random challenge (client-side use - not stored server-side due to serverless)
export function generateChallenge(): { challenge: string; expiresAt: number } {
  const challenge = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  return { challenge, expiresAt };
}

// Compute Nostr event ID (sha256 of serialized event)
function computeEventId(event: Omit<NostrEvent, 'id' | 'sig'>): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ]);
  return createHash('sha256').update(serialized).digest('hex');
}

// Verify Nostr event signature
export async function verifyNostrEvent(event: NostrEvent): Promise<boolean> {
  try {
    // Verify event ID matches computed hash
    const computedId = computeEventId(event);
    if (computedId !== event.id) {
      return false;
    }

    // Verify schnorr signature
    const sigBytes = Buffer.from(event.sig, 'hex');
    const idBytes = Buffer.from(event.id, 'hex');
    const pubkeyBytes = Buffer.from(event.pubkey, 'hex');

    return schnorr.verify(sigBytes, idBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

// Check if pubkey is in admin list
export function isAdminPubkey(pubkey: string): boolean {
  const adminPubkeys = process.env.MSP_ADMIN_PUBKEYS || '';
  const allowedPubkeys = adminPubkeys
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);
  if (allowedPubkeys.length === 0) {
    return false;
  }
  return allowedPubkeys.includes(pubkey.toLowerCase());
}

/** A list entry as a lowercase hex pubkey: hex as given, or an npub decoded. Null if neither. */
function toHexPubkey(entry: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(entry)) return entry.toLowerCase();
  if (!entry.toLowerCase().startsWith('npub1')) return null;
  try {
    const decoded = nip19.decode(entry);
    return decoded.type === 'npub' ? decoded.data.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Keys that may read the music chart and nothing else (MSP_CHART_PUBKEYS).
 *
 * MSP_ADMIN_PUBKEYS is the only other way in, and it carries far more than the chart:
 * listing, restoring and deleting every hosted feed, and the node's sats totals in the
 * coverage report. This list lets a collaborator see /charts without any of that.
 * Comma-separated npubs or hex — an npub is what people share, and the admin list, which
 * takes hex only, silently never matches one. An entry that is neither is skipped.
 */
export function isChartViewerPubkey(pubkey: string): boolean {
  const target = pubkey.toLowerCase();
  return (process.env.MSP_CHART_PUBKEYS || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .some(entry => toHexPubkey(entry) === target);
}

// Validate NIP-98 auth event for feed ownership (no admin check)
// Returns the pubkey if valid - caller checks ownership
export async function validateFeedAuthEvent(event: NostrEvent): Promise<{ valid: boolean; pubkey?: string; error?: string }> {
  // Check event kind (27235 for NIP-98 HTTP Auth)
  if (event.kind !== 27235) {
    return { valid: false, error: 'Invalid event kind' };
  }

  // Check event is recent (within 5 minutes) - prevents replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > 300) {
    return { valid: false, error: 'Event expired' };
  }

  // Verify signature - proves user controls the private key
  if (!await verifyNostrEvent(event)) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true, pubkey: event.pubkey };
}

// Parse auth header for feed ownership (no admin check)
export async function parseFeedAuthHeader(authHeader: string | undefined): Promise<{ valid: boolean; pubkey?: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith('Nostr ')) {
    return { valid: false, error: 'Missing or invalid auth header' };
  }

  try {
    const base64Event = authHeader.slice(6); // Remove 'Nostr ' prefix
    const eventJson = Buffer.from(base64Event, 'base64').toString('utf-8');
    const event: NostrEvent = JSON.parse(eventJson);

    return await validateFeedAuthEvent(event);
  } catch {
    return { valid: false, error: 'Failed to parse auth event' };
  }
}

// Validate NIP-98 auth event for admin access
// Security: signature proves key ownership, timestamp prevents replay, pubkey check ensures admin
export async function validateAdminAuthEvent(event: NostrEvent): Promise<{ valid: boolean; error?: string }> {
  // Check event kind (27235 for NIP-98 HTTP Auth)
  if (event.kind !== 27235) {
    return { valid: false, error: 'Invalid event kind' };
  }

  // Check event is recent (within 5 minutes) - prevents replay attacks
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > 300) {
    return { valid: false, error: 'Event expired' };
  }

  // Verify signature - proves user controls the private key
  if (!await verifyNostrEvent(event)) {
    return { valid: false, error: 'Invalid signature' };
  }

  // Check pubkey is admin
  if (!isAdminPubkey(event.pubkey)) {
    return { valid: false, error: 'Not an admin pubkey' };
  }

  return { valid: true };
}

// Parse and validate Authorization header
export async function parseAuthHeader(authHeader: string | undefined): Promise<{ valid: boolean; pubkey?: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith('Nostr ')) {
    return { valid: false, error: 'Missing or invalid auth header' };
  }

  try {
    const base64Event = authHeader.slice(6); // Remove 'Nostr ' prefix
    const eventJson = Buffer.from(base64Event, 'base64').toString('utf-8');
    const event: NostrEvent = JSON.parse(eventJson);

    const result = await validateAdminAuthEvent(event);
    if (!result.valid) {
      return result;
    }

    return { valid: true, pubkey: event.pubkey };
  } catch {
    return { valid: false, error: 'Failed to parse auth event' };
  }
}

/**
 * NIP-98 access to the music chart: a signed, recent event from an admin or from a key on
 * the chart-only list (isChartViewerPubkey). The signature and age checks are the ones
 * every other NIP-98 caller uses; only the list differs.
 */
export async function parseChartAuthHeader(authHeader: string | undefined): Promise<{ valid: boolean; pubkey?: string; error?: string }> {
  const auth = await parseFeedAuthHeader(authHeader);
  if (!auth.valid || !auth.pubkey) return auth;
  if (!isAdminPubkey(auth.pubkey) && !isChartViewerPubkey(auth.pubkey)) {
    return { valid: false, error: 'Not allowed to view the chart' };
  }
  return auth;
}
