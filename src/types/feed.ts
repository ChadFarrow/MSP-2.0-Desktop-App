// MSP 2.0 - Feed Type Definitions (Demu Template Compatible)

export interface Person {
  name: string;
  href?: string;
  img?: string;
  group: 'music' | 'writing' | 'production' | 'visuals' | 'other';
  role: string;
}

export interface ValueRecipient {
  name: string;
  address: string;
  split: number;
  type: 'node' | 'lnaddress';
  fee?: boolean;
  customKey?: string;
  customValue?: string;
}

export interface ValueBlock {
  type: 'lightning';
  method: 'keysend';
  suggested?: string;
  recipients: ValueRecipient[];
}

export interface Funding {
  url: string;
  text: string;
}

export interface Track {
  id: string;
  trackNumber: number;
  title: string;
  description: string;
  pubDate: string;
  guid: string;
  enclosureUrl: string;
  enclosureLength: string;
  enclosureType: string;
  duration: string;
  explicit: boolean;
  trackArtUrl?: string;
  bannerArtUrl?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  overridePersons: boolean;
  persons: Person[];
  overrideValue: boolean;
  value?: ValueBlock;
}

export interface Album {
  // Basic Info
  title: string;
  author: string;
  description: string;
  link: string;
  language: string;
  generator: string;
  pubDate: string;
  lastBuildDate: string;

  // Podcast Index
  podcastGuid: string;
  medium: 'music' | 'musicL';
  locked: boolean;
  lockedOwner: string;
  location: string;

  // iTunes
  categories: string[];
  explicit: boolean;

  // Artwork
  imageUrl: string;
  imageTitle: string;
  imageLink: string;
  imageDescription: string;
  bannerArtUrl: string;

  // Contact
  managingEditor: string;
  webMaster: string;

  // People & Value
  persons: Person[];
  value: ValueBlock;

  // Funding
  funding: Funding[];

  // Tracks
  tracks: Track[];
}

export interface FeedState {
  album: Album;
  isDirty: boolean;
  lastSaved: string | null;
}

// Default empty track (defined first so createEmptyAlbum can use it)
export const createEmptyTrack = (trackNumber: number): Track => ({
  id: crypto.randomUUID(),
  trackNumber,
  title: '',
  description: '',
  pubDate: new Date().toUTCString(),
  guid: crypto.randomUUID(),
  enclosureUrl: '',
  enclosureLength: '',
  enclosureType: 'audio/mpeg',
  duration: '',
  explicit: false,
  trackArtUrl: '',
  bannerArtUrl: '',
  transcriptUrl: '',
  transcriptType: 'application/srt',
  overridePersons: false,
  persons: [],
  overrideValue: false,
  value: undefined
});

// Default empty album
export const createEmptyAlbum = (): Album => ({
  title: '',
  author: '',
  description: '',
  link: '',
  language: 'en',
  generator: 'MSP 2.0 - Music Side Project Studio',
  pubDate: new Date().toUTCString(),
  lastBuildDate: new Date().toUTCString(),
  podcastGuid: crypto.randomUUID(),
  medium: 'music',
  locked: false,
  lockedOwner: '',
  location: '',
  categories: [],
  explicit: false,
  imageUrl: '',
  imageTitle: '',
  imageLink: '',
  imageDescription: '',
  bannerArtUrl: '',
  managingEditor: '',
  webMaster: '',
  persons: [],
  value: {
    type: 'lightning',
    method: 'keysend',
    suggested: '0.000033333',
    recipients: []
  },
  funding: [],
  tracks: [createEmptyTrack(1)]
});

// Default empty person
export const createEmptyPerson = (): Person => ({
  name: '',
  href: '',
  img: '',
  group: 'music',
  role: 'band'
});

// Default empty value recipient
export const createEmptyRecipient = (): ValueRecipient => ({
  name: '',
  address: '',
  split: 0,
  type: 'node'
});

// Default empty funding
export const createEmptyFunding = (): Funding => ({
  url: '',
  text: ''
});

// iTunes categories for music
export const ITUNES_CATEGORIES = [
  'Music',
  'Music Commentary',
  'Music History',
  'Music Interviews',
  'Technology',
  'Arts',
  'Society & Culture',
  'Leisure',
  'Education'
];

// Person groups
export const PERSON_GROUPS = [
  { value: 'music', label: 'Music' },
  { value: 'writing', label: 'Writing' },
  { value: 'production', label: 'Production' },
  { value: 'visuals', label: 'Visuals' },
  { value: 'other', label: 'Other' }
];

// Person roles by group
export const PERSON_ROLES: Record<string, { value: string; label: string }[]> = {
  music: [
    { value: 'band', label: 'Band' },
    { value: 'vocalist', label: 'Vocalist' },
    { value: 'guitarist', label: 'Guitarist' },
    { value: 'bassist', label: 'Bassist' },
    { value: 'drummer', label: 'Drummer' },
    { value: 'keyboardist', label: 'Keyboardist' },
    { value: 'musician', label: 'Musician' }
  ],
  writing: [
    { value: 'songwriter', label: 'Songwriter' },
    { value: 'lyricist', label: 'Lyricist' },
    { value: 'composer', label: 'Composer' }
  ],
  production: [
    { value: 'producer', label: 'Producer' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'mixer', label: 'Mixer' },
    { value: 'mastering', label: 'Mastering' }
  ],
  visuals: [
    { value: 'artist', label: 'Artist' },
    { value: 'designer', label: 'Designer' },
    { value: 'photographer', label: 'Photographer' }
  ],
  other: [
    { value: 'guest', label: 'Guest' },
    { value: 'contributor', label: 'Contributor' }
  ]
};

// Language codes
export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' }
];
