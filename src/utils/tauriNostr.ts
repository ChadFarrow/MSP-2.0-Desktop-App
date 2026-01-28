/**
 * Tauri Nostr Bridge
 * 
 * Drop-in replacement for NIP-07 browser extension.
 * Replace your existing nostr.ts imports with this file for desktop builds.
 */

import { invoke } from '@tauri-apps/api/core';

interface NostrProfile {
  pubkey: string;
  npub: string;
}

interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}

interface StoredKeyEntry {
  pubkey: string;
  mode: 'password' | 'device';
  created_at: number;
  label: string | null;
}

interface StoredKeysResponse {
  keys: StoredKeyEntry[];
}

// Legacy interface for backwards compatibility
interface StoredKeyInfo {
  keys: StoredKeyEntry[];
}

// Check if running in Tauri
export const isTauri = (): boolean => {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
};

// Check if NIP-07 extension is available (for web fallback)
export const hasNip07 = (): boolean => {
  return typeof window !== 'undefined' && 'nostr' in window;
};

/**
 * Login with nsec (bech32 private key)
 */
export async function loginWithNsec(nsec: string): Promise<NostrProfile> {
  return await invoke<NostrProfile>('nostr_login_nsec', { nsec });
}

/**
 * Login with hex private key
 */
export async function loginWithHex(hexKey: string): Promise<NostrProfile> {
  return await invoke<NostrProfile>('nostr_login_hex', { hexKey });
}

/**
 * Logout and clear keys
 */
export async function logout(): Promise<void> {
  return await invoke('nostr_logout');
}

/**
 * Get current pubkey if logged in
 */
export async function getPubkey(): Promise<NostrProfile | null> {
  return await invoke<NostrProfile | null>('nostr_get_pubkey');
}

/**
 * Sign an event (returns signed event without publishing)
 */
export async function signEvent(event: UnsignedEvent): Promise<SignedEvent> {
  return await invoke<SignedEvent>('nostr_sign_event', {
    kind: event.kind,
    content: event.content,
    tags: event.tags,
  });
}

/**
 * Sign and publish an event to relays
 */
export async function publishEvent(event: UnsignedEvent): Promise<string> {
  return await invoke<string>('nostr_publish_event', {
    kind: event.kind,
    content: event.content,
    tags: event.tags,
  });
}

/**
 * Fetch events from relays
 */
export async function fetchEvents(
  kinds: number[],
  authors?: string[],
  limit?: number
): Promise<SignedEvent[]> {
  return await invoke<SignedEvent[]>('nostr_fetch_events', {
    kinds,
    authors: authors || null,
    limit: limit || null,
  });
}

// ============================================================================
// Encrypted Key Storage (Multi-key support)
// ============================================================================

/**
 * List all stored keys
 */
export async function listStoredKeys(): Promise<StoredKeysResponse> {
  return await invoke<StoredKeysResponse>('list_stored_keys');
}

/**
 * Check if any encrypted keys are stored (backwards compatible)
 */
export async function checkStoredKey(): Promise<StoredKeyInfo> {
  return await invoke<StoredKeyInfo>('check_stored_key');
}

/**
 * Store nsec with password protection
 * @param label Optional user-defined label for this key
 */
export async function storeKeyWithPassword(
  nsec: string,
  password: string,
  label?: string
): Promise<void> {
  return await invoke('store_key_with_password', {
    nsec,
    password,
    label: label || null,
  });
}

/**
 * Store nsec with device-only protection (passwordless)
 * @param label Optional user-defined label for this key
 */
export async function storeKeyWithoutPassword(nsec: string, label?: string): Promise<void> {
  return await invoke('store_key_without_password', { nsec, label: label || null });
}

/**
 * Unlock a stored key and login
 * @param pubkey Pubkey of the key to unlock (optional, uses first key if not specified)
 * @param password Required if key was stored with password protection
 */
export async function unlockStoredKey(pubkey?: string, password?: string): Promise<NostrProfile> {
  return await invoke<NostrProfile>('unlock_stored_key', {
    pubkey: pubkey || null,
    password: password || null,
  });
}

/**
 * Remove a stored key by pubkey
 */
export async function removeStoredKey(pubkey: string): Promise<void> {
  return await invoke('remove_stored_key', { pubkey });
}

/**
 * Clear all stored keys
 */
export async function clearStoredKey(): Promise<void> {
  return await invoke('clear_stored_key');
}

/**
 * Update a key's label
 */
export async function updateKeyLabel(pubkey: string, label?: string): Promise<void> {
  return await invoke('update_key_label', { pubkey, label: label || null });
}

/**
 * Change key password or protection mode
 * @param pubkey Pubkey of the key to change
 * @param currentPassword Current password (null for device mode)
 * @param newPassword New password (null to switch to device mode)
 */
export async function changeKeyPassword(
  pubkey: string,
  currentPassword?: string,
  newPassword?: string
): Promise<void> {
  return await invoke('change_key_password', {
    pubkey,
    currentPassword: currentPassword || null,
    newPassword: newPassword || null,
  });
}

// ============================================================================
// Auto-unlock utilities
// ============================================================================

export interface AutoUnlockResult {
  /** Whether auto-unlock was successful */
  success: boolean;
  /** The profile if login succeeded */
  profile?: NostrProfile;
  /** Whether to show the unlock modal (multiple keys or password required) */
  showUnlockModal: boolean;
  /** The stored key info for the modal */
  storedKeyInfo: StoredKeyInfo | null;
}

/**
 * Attempt to auto-unlock stored keys on app startup.
 * If a single device-mode key exists, it will be auto-unlocked.
 * Otherwise, returns info needed to show an unlock modal.
 */
export async function tryAutoUnlockStoredKey(): Promise<AutoUnlockResult> {
  try {
    const keyInfo = await checkStoredKey();

    if (!keyInfo.keys || keyInfo.keys.length === 0) {
      return { success: false, showUnlockModal: false, storedKeyInfo: keyInfo };
    }

    // If there's only one key and it's device mode, auto-unlock
    if (keyInfo.keys.length === 1 && keyInfo.keys[0].mode === 'device') {
      try {
        const profile = await unlockStoredKey(keyInfo.keys[0].pubkey);
        return { success: true, profile, showUnlockModal: false, storedKeyInfo: keyInfo };
      } catch (e) {
        console.error('Auto-unlock failed:', e);
        // Device key failed, show modal for manual login
        return { success: false, showUnlockModal: true, storedKeyInfo: keyInfo };
      }
    }

    // Multiple keys or password-protected key - show unlock modal
    return { success: false, showUnlockModal: true, storedKeyInfo: keyInfo };
  } catch (e) {
    console.error('Failed to check stored key:', e);
    return { success: false, showUnlockModal: false, storedKeyInfo: null };
  }
}

/**
 * NIP-07 compatible interface for easier migration
 * Use this as a drop-in replacement for window.nostr
 */
export const tauriNostr = {
  async getPublicKey(): Promise<string> {
    const profile = await getPubkey();
    if (!profile) throw new Error('Not logged in');
    return profile.pubkey;
  },

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    return await signEvent(event);
  },

  // Tauri-specific extensions
  loginWithNsec,
  loginWithHex,
  logout,
  getPubkey,
  publishEvent,
  fetchEvents,
  // Key storage (multi-key)
  listStoredKeys,
  checkStoredKey,
  storeKeyWithPassword,
  storeKeyWithoutPassword,
  unlockStoredKey,
  removeStoredKey,
  clearStoredKey,
  updateKeyLabel,
  changeKeyPassword,
};

/**
 * Universal Nostr interface - works with both Tauri and NIP-07
 */
export function getNostrInterface() {
  if (isTauri()) {
    return tauriNostr;
  }
  
  if (hasNip07()) {
    // Return the browser extension with our extensions stubbed
    return {
      ...window.nostr,
      loginWithNsec: () => Promise.reject(new Error('Use browser extension to login')),
      loginWithHex: () => Promise.reject(new Error('Use browser extension to login')),
      logout: () => Promise.resolve(),
      getPubkey: async () => {
        const pubkey = await window.nostr!.getPublicKey();
        return { pubkey, npub: '' };
      },
      publishEvent: async (event: UnsignedEvent) => {
        const nostr = window.nostr!;
        const signed = await nostr.signEvent(event as Parameters<typeof nostr.signEvent>[0]);
        // In web mode, you'd need to publish via your existing relay logic
        return signed.id;
      },
      fetchEvents: () => Promise.reject(new Error('Use existing relay logic for web')),
    };
  }
  
  throw new Error('No Nostr interface available');
}

export type { NostrProfile, SignedEvent, UnsignedEvent, StoredKeyInfo, StoredKeyEntry, StoredKeysResponse };
