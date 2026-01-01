import type { NostrUser } from '../types/nostr';

// Storage key for persisted auth
export const NOSTR_STORAGE_KEY = 'msp2-nostr-user';

// Bech32 encoding for npub conversion
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// Convert hex string to bytes
function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

// Convert bits between different bases
function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

// Bech32 polymod for checksum
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

// Create bech32 checksum
function bech32Checksum(prefix: string, words: number[]): string {
  const prefixExpanded = [...prefix].map(c => c.charCodeAt(0) >> 5)
    .concat([0])
    .concat([...prefix].map(c => c.charCodeAt(0) & 31));

  const values = prefixExpanded.concat(words).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;
  const checksum: string[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push(BECH32_ALPHABET[(mod >> (5 * (5 - i))) & 31]);
  }
  return checksum.join('');
}

// Convert hex pubkey to npub (bech32)
export function hexToNpub(hex: string): string {
  const prefix = 'npub';
  const words = convertBits(hexToBytes(hex), 8, 5, true);
  const checksum = bech32Checksum(prefix, words);
  return prefix + '1' + words.map(w => BECH32_ALPHABET[w]).join('') + checksum;
}

// Convert npub (bech32) back to hex pubkey
export function npubToHex(npub: string): string {
  if (!npub.startsWith('npub1')) {
    throw new Error('Invalid npub: must start with npub1');
  }

  // Remove prefix 'npub1'
  const data = npub.slice(5);

  // Decode bech32 characters to 5-bit words (excluding 6-char checksum)
  const words: number[] = [];
  for (let i = 0; i < data.length - 6; i++) {
    const idx = BECH32_ALPHABET.indexOf(data[i]);
    if (idx === -1) {
      throw new Error('Invalid bech32 character');
    }
    words.push(idx);
  }

  // Convert 5-bit words back to 8-bit bytes
  const bytes = convertBits(words, 5, 8, false);

  // Convert bytes to hex
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Truncate npub for display (shows npub1 + first 8 + ... + last 4)
export function truncateNpub(npub: string): string {
  if (npub.length <= 20) return npub;
  return `${npub.slice(0, 13)}...${npub.slice(-4)}`;
}

// Check if NIP-07 extension is available
export function hasNostrExtension(): boolean {
  return typeof window !== 'undefined' && typeof window.nostr !== 'undefined';
}

// Wait for extension to be available (some inject late)
export async function waitForNostrExtension(timeout = 3000): Promise<boolean> {
  if (hasNostrExtension()) return true;

  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (hasNostrExtension()) {
        clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

// Get public key from extension
export async function getPublicKey(): Promise<string> {
  if (!window.nostr) {
    throw new Error('Nostr extension not found');
  }
  return window.nostr.getPublicKey();
}

// Load user from localStorage
export function loadStoredUser(): NostrUser | null {
  try {
    const stored = localStorage.getItem(NOSTR_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load Nostr user from storage:', e);
  }
  return null;
}

// Save user to localStorage
export function saveUser(user: NostrUser): void {
  try {
    localStorage.setItem(NOSTR_STORAGE_KEY, JSON.stringify(user));
  } catch (e) {
    console.error('Failed to save Nostr user to storage:', e);
  }
}

// Clear user from localStorage
export function clearStoredUser(): void {
  try {
    localStorage.removeItem(NOSTR_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear Nostr user from storage:', e);
  }
}
