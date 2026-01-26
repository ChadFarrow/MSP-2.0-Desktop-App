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
  } catch (e) {
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
    // Don't clear credentials on timeout - user can try again manually
    if (e instanceof Error && e.message === 'Connection timeout') {
      return null;
    }
    clearBunkerPointer();
    clearClientSecretKey();
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
