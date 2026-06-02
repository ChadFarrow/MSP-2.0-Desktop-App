// Unified Nostr Signer - supports both NIP-07 (extension) and NIP-46 (remote signer)
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import type { BunkerPointer } from 'nostr-tools/nip46';

// Default relays for NIP-46 connections
export const NIP46_RELAYS = [
  'wss://relay.nsec.app',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

// Storage keys
const CLIENT_SECRET_KEY = 'msp_nip46_client_secret';
const BUNKER_POINTER_KEY = 'msp_nip46_bunker_pointer';
const CONNECTION_METHOD_KEY = 'msp_nostr_connection_method';

// Signer interface
export interface NostrSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  close?(): void;
}

// Current active signer
let currentSigner: NostrSigner | null = null;
let currentMethod: 'nip07' | 'nip46' | null = null;

// NIP-07 Signer (browser extension)
class Nip07Signer implements NostrSigner {
  async getPublicKey(): Promise<string> {
    if (!window.nostr) {
      throw new Error('No Nostr extension found');
    }
    return window.nostr.getPublicKey();
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    if (!window.nostr) {
      throw new Error('No Nostr extension found');
    }
    const signed = await window.nostr.signEvent(event as Parameters<typeof window.nostr.signEvent>[0]);
    return signed as VerifiedEvent;
  }
}

// NIP-46 Signer wrapper
class Nip46SignerWrapper implements NostrSigner {
  private bunkerSigner: BunkerSigner;
  private pool: SimplePool;

  constructor(bunkerSigner: BunkerSigner, pool: SimplePool) {
    this.bunkerSigner = bunkerSigner;
    this.pool = pool;
  }

  async getPublicKey(): Promise<string> {
    return this.bunkerSigner.getPublicKey();
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.bunkerSigner.signEvent(event) as Promise<VerifiedEvent>;
  }

  close(): void {
    this.bunkerSigner.close();
    this.pool.close(NIP46_RELAYS);
  }
}

// Get or generate client secret key for NIP-46
function getClientSecretKey(): Uint8Array {
  const stored = localStorage.getItem(CLIENT_SECRET_KEY);
  if (stored) {
    return hexToBytes(stored);
  }
  const sk = generateSecretKey();
  localStorage.setItem(CLIENT_SECRET_KEY, bytesToHex(sk));
  return sk;
}

// Clear client secret key
function clearClientSecretKey(): void {
  localStorage.removeItem(CLIENT_SECRET_KEY);
}

// Store bunker pointer for reconnection
export function storeBunkerPointer(pointer: { pubkey: string; relays: string[]; secret?: string }): void {
  localStorage.setItem(BUNKER_POINTER_KEY, JSON.stringify(pointer));
}

// Load bunker pointer
export function loadBunkerPointer(): { pubkey: string; relays: string[]; secret?: string } | null {
  const stored = localStorage.getItem(BUNKER_POINTER_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Clear bunker pointer
export function clearBunkerPointer(): void {
  localStorage.removeItem(BUNKER_POINTER_KEY);
}

// Store connection method
export function storeConnectionMethod(method: 'nip07' | 'nip46'): void {
  localStorage.setItem(CONNECTION_METHOD_KEY, method);
}

// Load connection method
export function loadConnectionMethod(): 'nip07' | 'nip46' | null {
  const stored = localStorage.getItem(CONNECTION_METHOD_KEY);
  if (stored === 'nip07' || stored === 'nip46') return stored;
  return null;
}

// Clear connection method
export function clearConnectionMethod(): void {
  localStorage.removeItem(CONNECTION_METHOD_KEY);
}

// Generate nostrconnect:// URI for client-initiated flow
export function generateNostrConnectUri(clientPubkey: string, secret: string): string {
  return createNostrConnectURI({
    clientPubkey,
    relays: NIP46_RELAYS,
    secret,
    name: 'Music Side Project',
  });
}

// Initialize NIP-07 signer
export async function initNip07Signer(): Promise<string> {
  if (!window.nostr) {
    throw new Error('No Nostr extension found. Please install Alby or another NIP-07 extension.');
  }

  const signer = new Nip07Signer();
  const pubkey = await signer.getPublicKey();

  currentSigner = signer;
  currentMethod = 'nip07';
  storeConnectionMethod('nip07');

  return pubkey;
}

// Initialize NIP-46 signer from bunker URI
export async function initNip46SignerFromBunker(bunkerUri: string): Promise<string> {
  const bunkerPointer = await parseBunkerInput(bunkerUri);
  if (!bunkerPointer) {
    throw new Error('Invalid bunker URI');
  }

  const clientSk = getClientSecretKey();
  const pool = new SimplePool();

  const bunkerSigner = BunkerSigner.fromBunker(clientSk, bunkerPointer, { pool });
  await bunkerSigner.connect();

  const pubkey = await bunkerSigner.getPublicKey();

  // Store for reconnection
  storeBunkerPointer({
    pubkey: bunkerPointer.pubkey,
    relays: bunkerPointer.relays || NIP46_RELAYS,
    secret: bunkerPointer.secret || undefined,
  });

  currentSigner = new Nip46SignerWrapper(bunkerSigner, pool);
  currentMethod = 'nip46';
  storeConnectionMethod('nip46');

  return pubkey;
}

// Wait for remote signer connection (client-initiated flow)
export async function waitForNip46Connection(
  onUriGenerated: (uri: string, clientPubkey: string) => void,
  timeoutMs: number = 120000
): Promise<string> {
  const clientSk = getClientSecretKey();
  const clientPubkey = getPublicKey(clientSk);
  const secret = crypto.randomUUID();

  const uri = generateNostrConnectUri(clientPubkey, secret);
  onUriGenerated(uri, clientPubkey);

  const pool = new SimplePool();

  try {
    // BunkerSigner.fromURI waits for the bunker to connect and returns ready-to-use signer
    const bunkerSigner = await BunkerSigner.fromURI(clientSk, uri, { pool }, timeoutMs);

    // Get the user's public key
    const userPubkey = await bunkerSigner.getPublicKey();

    // Get bunker pubkey from signer for storage (the remote signer's pubkey)
    const bunkerPubkey = bunkerSigner.bp.pubkey;

    // Store for reconnection
    storeBunkerPointer({
      pubkey: bunkerPubkey,
      relays: NIP46_RELAYS,
      secret,
    });

    currentSigner = new Nip46SignerWrapper(bunkerSigner, pool);
    currentMethod = 'nip46';
    storeConnectionMethod('nip46');

    return userPubkey;
  } catch {
    pool.close(NIP46_RELAYS);
    throw new Error('Connection timeout - no response from signer');
  }
}

// Reconnect to existing NIP-46 session
export async function reconnectNip46(timeoutMs: number = 10000): Promise<string | null> {
  const pointer = loadBunkerPointer();
  if (!pointer || !pointer.pubkey) return null;

  const clientSk = getClientSecretKey();
  const pool = new SimplePool();

  // Close the existing signer before creating a new one to avoid leaking pool connections
  if (currentSigner?.close) {
    try { currentSigner.close(); } catch { /* ignore close errors */ }
  }
  currentSigner = null;
  currentMethod = null;

  try {
    // Create bunker pointer with proper format
    const bunkerPointer: BunkerPointer = {
      pubkey: pointer.pubkey,
      relays: pointer.relays || NIP46_RELAYS,
      secret: pointer.secret ?? null,
    };

    const bunkerSigner = BunkerSigner.fromBunker(clientSk, bunkerPointer, { pool });

    // Add timeout to connection attempt
    await Promise.race([
      bunkerSigner.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
      )
    ]);

    const pubkey = await bunkerSigner.getPublicKey();

    currentSigner = new Nip46SignerWrapper(bunkerSigner, pool);
    currentMethod = 'nip46';

    return pubkey;
  } catch (e) {
    console.error('Failed to reconnect NIP-46:', e);
    pool.close(NIP46_RELAYS);
    // Never clear stored credentials automatically — connection failures are transient
    // (network outage, relay down, signer app in background). The user explicitly logs
    // out to clear credentials. Silently wiping them causes data loss.
    return null;
  }
}

// Get current signer
export function getSigner(): NostrSigner {
  if (!currentSigner) {
    throw new Error('No signer initialized. Please log in first.');
  }
  return currentSigner;
}

// Sign an event with a timeout so a non-responsive remote signer doesn't hang the UI indefinitely.
// Default: 60 s for NIP-46 (user may need to unlock phone + tap), 30 s for NIP-07 (local extension popup).
export async function signEventWithTimeout(
  event: EventTemplate,
  timeoutMs?: number
): Promise<VerifiedEvent> {
  const method = currentMethod;
  const effectiveTimeout = timeoutMs ?? (method === 'nip46' ? 60_000 : 30_000);

  return Promise.race([
    getSigner().signEvent(event),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          'Signer request timed out. If you use a remote signer app (Primal, Amber, nsecBunker), please open it and approve the pending request, then try again.'
        )),
        effectiveTimeout
      )
    ),
  ]);
}

// Same shape as signEventWithTimeout for the getPublicKey round-trip — NIP-46 sends a
// request to the remote signer app, which can hang if the phone is asleep.
export async function getPublicKeyWithTimeout(timeoutMs?: number): Promise<string> {
  const method = currentMethod;
  const effectiveTimeout = timeoutMs ?? (method === 'nip46' ? 60_000 : 30_000);

  return Promise.race([
    getSigner().getPublicKey(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          'Signer request timed out. If you use a remote signer app (Primal, Amber, nsecBunker), please open it and approve the pending request, then try again.'
        )),
        effectiveTimeout
      )
    ),
  ]);
}

// Check whether the signer is reachable before starting a Nostr operation.
// Returns { connected: true } quickly or { connected: false, error } without throwing.
//
// NIP-46 strategy: if a signer is already initialised, trust it — SimplePool maintains
// relay connections automatically, so we avoid a redundant reconnect that would close
// the working connection and send a new "connect" request requiring Primal approval.
// Only reconnect when currentSigner is null (e.g. first use after a page-load timeout).
export async function checkSignerConnection(timeoutMs?: number): Promise<{ connected: boolean; error?: string }> {
  const method = currentMethod ?? loadConnectionMethod();

  if (method === 'nip46') {
    if (hasSigner()) {
      // Active signer — pool manages relay reconnects automatically.
      return { connected: true };
    }

    // Signer is gone (page-load reconnect timed out, or first use after restore).
    // If credentials are stored, reconnect now. Give enough time for the user to
    // open their iOS signer app and approve.
    if (!loadBunkerPointer()) {
      return { connected: false, error: 'Not logged in to Nostr. Please log in and try again.' };
    }

    const pubkey = await reconnectNip46(timeoutMs ?? 30_000);
    if (pubkey) return { connected: true };
    return {
      connected: false,
      error: 'Could not reach your remote signer. Open your signer app (Primal, Amber, nsecBunker), approve the connection request, then try again.'
    };
  }

  // NIP-07 (browser extension)
  if (!hasSigner()) {
    return { connected: false, error: 'Not logged in to Nostr. Please log in and try again.' };
  }

  try {
    await Promise.race([
      getSigner().getPublicKey(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs ?? 3_000)
      ),
    ]);
    return { connected: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg === 'timeout') {
      return {
        connected: false,
        error: 'Could not reach your browser extension. Make sure it is unlocked and try again.'
      };
    }
    return { connected: false, error: msg };
  }
}

// Check if a signer is active
export function hasSigner(): boolean {
  return currentSigner !== null;
}

// Get current connection method
export function getConnectionMethod(): 'nip07' | 'nip46' | null {
  return currentMethod;
}

// Clear signer (logout)
export function clearSigner(): void {
  if (currentSigner?.close) {
    currentSigner.close();
  }
  currentSigner = null;
  currentMethod = null;
  clearBunkerPointer();
  clearClientSecretKey();
  clearConnectionMethod();
}

// Check if NIP-07 extension is available
export function hasNip07Extension(): boolean {
  return typeof window !== 'undefined' && typeof window.nostr !== 'undefined';
}
