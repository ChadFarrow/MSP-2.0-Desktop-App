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
        const signed = await window.nostr!.signEvent(event as Parameters<typeof window.nostr!.signEvent>[0]);
        // In web mode, you'd need to publish via your existing relay logic
        return signed.id;
      },
      fetchEvents: () => Promise.reject(new Error('Use existing relay logic for web')),
    };
  }
  
  throw new Error('No Nostr interface available');
}

export type { NostrProfile, SignedEvent, UnsignedEvent };
