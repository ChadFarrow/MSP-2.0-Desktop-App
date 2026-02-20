import { createHash, randomBytes, createHmac } from 'crypto';
import * as secp from '@noble/secp256k1';

// Configure @noble/secp256k1 v3 with Node.js crypto
secp.hashes.sha256 = (...msgs: Uint8Array[]) => {
  const hash = createHash('sha256');
  for (const msg of msgs) hash.update(msg);
  return Uint8Array.from(hash.digest());
};
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
  const allowedPubkeys = adminPubkeys.split(',').map(p => p.trim().toLowerCase());
  return allowedPubkeys.includes(pubkey.toLowerCase());
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
