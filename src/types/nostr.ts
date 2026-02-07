// NIP-07 Browser Extension API Types
// Specification: https://github.com/nostr-protocol/nips/blob/master/07.md

export interface NostrEvent {
  id?: string;
  pubkey?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface NostrRelays {
  [url: string]: { read: boolean; write: boolean };
}

// NIP-07 window.nostr interface
export interface Nip07Extension {
  getPublicKey(): Promise<string>;
  signEvent(event: NostrEvent): Promise<NostrEvent>;
  getRelays?(): Promise<NostrRelays>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

// Extend the Window interface
declare global {
  interface Window {
    nostr?: Nip07Extension;
  }
}

// User profile state
export interface NostrUser {
  pubkey: string;       // hex pubkey
  npub: string;         // bech32 npub
  displayName?: string; // from profile metadata (kind 0)
  picture?: string;     // profile picture URL
  nip05?: string;       // NIP-05 identifier
}

// Auth state
export interface NostrAuthState {
  isLoggedIn: boolean;
  user: NostrUser | null;
  isLoading: boolean;
  error: string | null;
  hasExtension: boolean;
  connectionMethod: 'nip07' | 'nip46' | 'tauri' | null;
}

// Saved album info from Nostr
export interface SavedAlbumInfo {
  id: string;           // event id
  dTag: string;         // d tag (album guid)
  title: string;        // album title
  createdAt: number;    // timestamp
  pubkey: string;       // author pubkey
}

// Kind 36787 Music Track - Zap split info
export interface NostrZapSplit {
  pubkey: string;
  relay?: string;
  splitPercentage: number;
}

// Kind 34139 Music Playlist - Published track reference
export interface PublishedTrackRef {
  dTag: string;
  pubkey: string;
}

// Kind 36787 Music Track - Parsed content sections
export interface NostrMusicContent {
  lyrics?: string;
  credits?: string;
  license?: string;
}

// Kind 36787 Music Track - Parsed track info
export interface NostrMusicTrackInfo {
  id: string;
  dTag: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  url: string;
  imageUrl?: string;
  released?: string;
  language?: string;
  genres: string[];
  zapSplits: NostrZapSplit[];
  content: NostrMusicContent;
  createdAt: number;
}

// Grouped by album for UI display
export interface NostrMusicAlbumGroup {
  albumName: string;
  artist: string;
  imageUrl?: string;
  tracks: NostrMusicTrackInfo[];
}
