// Centralized localStorage utilities for MSP 2.0
import type { Album, Person, PersonRole, PersonGroup, PublisherFeed, FeedType } from '../types/feed';
import type { NostrUser } from '../types/nostr';

// Storage keys
export const STORAGE_KEYS = {
  ALBUM_DATA: 'msp2-album-data',
  VIDEO_DATA: 'msp2-video-data',
  PUBLISHER_DATA: 'msp2-publisher-data',
  FEED_TYPE: 'msp2-feed-type',
  NOSTR_USER: 'msp2-nostr-user',
  HOSTED_PREFIX: 'msp2-hosted-',
  PENDING_HOSTED: 'msp2-pending-hosted',
  EMAIL_SESSION: 'msp2-email-session'
} as const;

// Migration helper: convert old person format to new format
// Old: { name, href, img, group, role }
// New: { name, href, img, roles: [{group, role}] }
interface OldPerson {
  name: string;
  href?: string;
  img?: string;
  group?: string;
  role?: string;
  roles?: PersonRole[];
}

function migratePerson(person: OldPerson): Person {
  // Already migrated
  if (person.roles && Array.isArray(person.roles)) {
    return person as Person;
  }
  // Migrate old format
  const group = (person.group || 'music') as PersonGroup;
  const role = person.role || 'band';
  return {
    name: person.name || '',
    href: person.href,
    img: person.img,
    roles: [{ group, role }]
  };
}

function migrateAlbum(album: Album & { persons?: OldPerson[]; tracks?: Array<{ persons?: OldPerson[] }> }): Album {
  // Migrate album-level persons
  if (album.persons) {
    album.persons = album.persons.map(migratePerson);
  }
  // Migrate track-level persons
  if (album.tracks) {
    album.tracks = album.tracks.map(track => {
      if (track.persons) {
        track.persons = track.persons.map(migratePerson);
      }
      return track;
    });
  }
  return album as Album;
}

/**
 * Safely get an item from localStorage with JSON parsing
 */
function getItem<T>(key: string): T | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch (e) {
    console.error(`Failed to load from localStorage (${key}):`, e);
  }
  return null;
}

/**
 * Safely set an item in localStorage with JSON stringification
 */
function setItem<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`Failed to save to localStorage (${key}):`, e);
    return false;
  }
}

/**
 * Safely remove an item from localStorage
 */
function removeItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.error(`Failed to remove from localStorage (${key}):`, e);
    return false;
  }
}

// Album storage operations
export const albumStorage = {
  load: (): Album | null => {
    const album = getItem<Album>(STORAGE_KEYS.ALBUM_DATA);
    if (album) {
      return migrateAlbum(album);
    }
    return null;
  },
  save: (album: Album): boolean => setItem(STORAGE_KEYS.ALBUM_DATA, album),
  clear: (): boolean => removeItem(STORAGE_KEYS.ALBUM_DATA)
};

// Video feed storage operations
export const videoStorage = {
  load: (): Album | null => {
    const album = getItem<Album>(STORAGE_KEYS.VIDEO_DATA);
    if (album) {
      return migrateAlbum(album);
    }
    return null;
  },
  save: (album: Album): boolean => setItem(STORAGE_KEYS.VIDEO_DATA, album),
  clear: (): boolean => removeItem(STORAGE_KEYS.VIDEO_DATA)
};

// Publisher feed storage operations
export const publisherStorage = {
  load: (): PublisherFeed | null => getItem<PublisherFeed>(STORAGE_KEYS.PUBLISHER_DATA),
  save: (feed: PublisherFeed): boolean => setItem(STORAGE_KEYS.PUBLISHER_DATA, feed),
  clear: (): boolean => removeItem(STORAGE_KEYS.PUBLISHER_DATA)
};

// Feed type storage operations
export const feedTypeStorage = {
  load: (): FeedType => {
    const stored = getItem<FeedType>(STORAGE_KEYS.FEED_TYPE);
    return stored && ['album', 'video', 'publisher'].includes(stored) ? stored : 'album';
  },
  save: (feedType: FeedType): boolean => setItem(STORAGE_KEYS.FEED_TYPE, feedType)
};

// Nostr user storage operations
export const nostrUserStorage = {
  load: (): NostrUser | null => getItem<NostrUser>(STORAGE_KEYS.NOSTR_USER),
  save: (user: NostrUser): boolean => setItem(STORAGE_KEYS.NOSTR_USER, user),
  clear: (): boolean => removeItem(STORAGE_KEYS.NOSTR_USER)
};

// Hosted feed info type (re-exported from hostedFeed)
export interface HostedFeedInfo {
  feedId: string;
  editToken: string;
  createdAt: number;
  lastUpdated: number;
  ownerPubkey?: string;     // Nostr pubkey if linked
  linkedAt?: number;        // When Nostr was linked
  ownerEmailHash?: string;  // Keyed HMAC of owner email if claimed via email
  emailLinkedAt?: number;   // When the email was linked
  isDraft?: boolean;        // True when hosted without PI/podping notification
}

// Hosted feed storage operations
export const hostedFeedStorage = {
  load: (podcastGuid: string): HostedFeedInfo | null =>
    getItem<HostedFeedInfo>(`${STORAGE_KEYS.HOSTED_PREFIX}${podcastGuid}`),

  save: (podcastGuid: string, info: HostedFeedInfo): boolean =>
    setItem(`${STORAGE_KEYS.HOSTED_PREFIX}${podcastGuid}`, info),

  clear: (podcastGuid: string): boolean =>
    removeItem(`${STORAGE_KEYS.HOSTED_PREFIX}${podcastGuid}`)
};

// Pending hosted credentials (temporary storage during import)
export const pendingHostedStorage = {
  load: (): HostedFeedInfo | null => getItem<HostedFeedInfo>(STORAGE_KEYS.PENDING_HOSTED),
  save: (info: HostedFeedInfo): boolean => setItem(STORAGE_KEYS.PENDING_HOSTED, info),
  clear: (): boolean => removeItem(STORAGE_KEYS.PENDING_HOSTED)
};

// Email auth session (magic-link). The session JWT is opaque; emailHash identifies the account.
export interface EmailSessionInfo {
  session: string;    // signed session JWT sent as X-Email-Session: Bearer <session>
  emailHash: string;  // server-issued opaque account id
  email?: string;     // the address the user typed, kept locally for display only
  createdAt: number;
}

export const emailSessionStorage = {
  load: (): EmailSessionInfo | null => getItem<EmailSessionInfo>(STORAGE_KEYS.EMAIL_SESSION),
  save: (info: EmailSessionInfo): boolean => setItem(STORAGE_KEYS.EMAIL_SESSION, info),
  clear: (): boolean => removeItem(STORAGE_KEYS.EMAIL_SESSION)
};
