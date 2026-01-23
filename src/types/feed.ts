// MSP 2.0 - Feed Type Definitions (Demu Template Compatible)

// All person groups from Podcasting 2.0 taxonomy + custom 'music' group
export type PersonGroup =
  | 'music'
  | 'creative-direction'
  | 'cast'
  | 'writing'
  | 'audio-production'
  | 'audio-post-production'
  | 'administration'
  | 'visuals'
  | 'community'
  | 'misc'
  | 'video-production'
  | 'video-post-production';

// A single group+role pair
export interface PersonRole {
  group: PersonGroup;
  role: string;
}

// A person with multiple roles across groups
export interface Person {
  name: string;
  href?: string;
  img?: string;
  roles: PersonRole[];
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

// Remote item for referencing other feeds (used in publisher feeds and podroll)
export interface RemoteItem {
  feedGuid: string;
  feedUrl?: string;
  itemGuid?: string;
  medium?: string;
  title?: string;
  image?: string;
}

// Base channel data shared between Album and PublisherFeed
export interface BaseChannelData {
  title: string;
  author: string;
  description: string;
  link: string;
  language: string;
  generator: string;
  pubDate: string;
  lastBuildDate: string;
  podcastGuid: string;
  locked: boolean;
  lockedOwner: string;
  location: string;
  categories: string[];
  keywords: string;
  explicit: boolean;
  ownerName: string;
  ownerEmail: string;
  imageUrl: string;
  imageTitle: string;
  imageLink: string;
  imageDescription: string;
  managingEditor: string;
  webMaster: string;
  persons: Person[];
  value: ValueBlock;
  funding: Funding[];
  unknownChannelElements?: Record<string, unknown>;
}

// Publisher reference - allows a feed to link to its parent publisher feed
export interface PublisherReference {
  feedGuid: string;
  feedUrl?: string;
}

export interface Track {
  id: string;
  trackNumber: number;
  season?: number;
  episode?: number;
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
  trackArtWidth?: number;
  trackArtHeight?: number;
  bannerArtUrl?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  overridePersons: boolean;
  persons: Person[];
  overrideValue: boolean;
  value?: ValueBlock;
  unknownItemElements?: Record<string, unknown>;
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
  keywords: string;
  explicit: boolean;
  ownerName: string;
  ownerEmail: string;

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

  // Publisher reference (optional - links this feed to a parent publisher feed)
  publisher?: PublisherReference;

  // Unknown/unsupported XML elements (preserved for round-trip)
  unknownChannelElements?: Record<string, unknown>;

  // Tracks
  tracks: Track[];
}

// Publisher feed - aggregates multiple feeds under one publisher
export type PublisherMedium = 'publisher';

export interface PublisherFeed {
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
  medium: PublisherMedium;
  locked: boolean;
  lockedOwner: string;
  location: string;

  // iTunes
  categories: string[];
  keywords: string;
  explicit: boolean;
  ownerName: string;
  ownerEmail: string;

  // Artwork
  imageUrl: string;
  imageTitle: string;
  imageLink: string;
  imageDescription: string;

  // Contact
  managingEditor: string;
  webMaster: string;

  // People & Value (optional for publisher feeds)
  persons: Person[];
  value: ValueBlock;

  // Funding
  funding: Funding[];

  // Unknown/unsupported XML elements (preserved for round-trip)
  unknownChannelElements?: Record<string, unknown>;

  // Remote items - the feeds this publisher owns
  remoteItems: RemoteItem[];
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
  season: undefined,
  episode: undefined,
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
  keywords: '',
  explicit: false,
  ownerName: '',
  ownerEmail: '',
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

// Default empty person role
export const createEmptyPersonRole = (): PersonRole => ({
  group: 'music',
  role: 'band'
});

// Default empty person
export const createEmptyPerson = (): Person => ({
  name: '',
  href: '',
  img: '',
  roles: [createEmptyPersonRole()]
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

// Default empty remote item
export const createEmptyRemoteItem = (): RemoteItem => ({
  feedGuid: '',
  feedUrl: '',
  title: ''
});

// Default empty publisher reference
export const createEmptyPublisherReference = (): PublisherReference => ({
  feedGuid: '',
  feedUrl: ''
});

// Default empty publisher feed
export const createEmptyPublisherFeed = (): PublisherFeed => ({
  title: '',
  author: '',
  description: '',
  link: '',
  language: 'en',
  generator: 'MSP 2.0 - Music Side Project Studio',
  pubDate: new Date().toUTCString(),
  lastBuildDate: new Date().toUTCString(),
  podcastGuid: crypto.randomUUID(),
  medium: 'publisher',
  locked: false,
  lockedOwner: '',
  location: '',
  categories: [],
  keywords: '',
  explicit: false,
  ownerName: '',
  ownerEmail: '',
  imageUrl: '',
  imageTitle: '',
  imageLink: '',
  imageDescription: '',
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
  remoteItems: []
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

// Person groups - Podcasting 2.0 taxonomy + custom 'music' group
export const PERSON_GROUPS: { value: PersonGroup; label: string }[] = [
  { value: 'music', label: 'Music' },
  { value: 'creative-direction', label: 'Creative Direction' },
  { value: 'cast', label: 'Cast' },
  { value: 'writing', label: 'Writing' },
  { value: 'audio-production', label: 'Audio Production' },
  { value: 'audio-post-production', label: 'Audio Post-Production' },
  { value: 'administration', label: 'Administration' },
  { value: 'visuals', label: 'Visuals' },
  { value: 'community', label: 'Community' },
  { value: 'misc', label: 'Misc.' },
  { value: 'video-production', label: 'Video Production' },
  { value: 'video-post-production', label: 'Video Post-Production' }
];

// Person roles by group - Podcasting 2.0 taxonomy + custom music roles
export const PERSON_ROLES: Record<PersonGroup, { value: string; label: string }[]> = {
  // Custom music group for musicians
  'music': [
    { value: 'band', label: 'Band' },
    { value: 'vocalist', label: 'Vocalist' },
    { value: 'guitarist', label: 'Guitarist' },
    { value: 'bassist', label: 'Bassist' },
    { value: 'drummer', label: 'Drummer' },
    { value: 'keyboardist', label: 'Keyboardist' },
    { value: 'musician', label: 'Musician' }
  ],
  // Official taxonomy groups
  'creative-direction': [
    { value: 'director', label: 'Director' },
    { value: 'assistant director', label: 'Assistant Director' },
    { value: 'executive producer', label: 'Executive Producer' },
    { value: 'senior producer', label: 'Senior Producer' },
    { value: 'producer', label: 'Producer' },
    { value: 'associate producer', label: 'Associate Producer' },
    { value: 'development producer', label: 'Development Producer' },
    { value: 'creative director', label: 'Creative Director' }
  ],
  'cast': [
    { value: 'host', label: 'Host' },
    { value: 'co-host', label: 'Co-Host' },
    { value: 'guest host', label: 'Guest Host' },
    { value: 'guest', label: 'Guest' },
    { value: 'voice actor', label: 'Voice Actor' },
    { value: 'narrator', label: 'Narrator' },
    { value: 'announcer', label: 'Announcer' },
    { value: 'reporter', label: 'Reporter' }
  ],
  'writing': [
    { value: 'author', label: 'Author' },
    { value: 'editorial director', label: 'Editorial Director' },
    { value: 'co-writer', label: 'Co-Writer' },
    { value: 'writer', label: 'Writer' },
    { value: 'songwriter', label: 'Songwriter' },
    { value: 'guest writer', label: 'Guest Writer' },
    { value: 'story editor', label: 'Story Editor' },
    { value: 'managing editor', label: 'Managing Editor' },
    { value: 'script editor', label: 'Script Editor' },
    { value: 'script coordinator', label: 'Script Coordinator' },
    { value: 'researcher', label: 'Researcher' },
    { value: 'editor', label: 'Editor' },
    { value: 'fact checker', label: 'Fact Checker' },
    { value: 'translator', label: 'Translator' },
    { value: 'transcriber', label: 'Transcriber' },
    { value: 'logger', label: 'Logger' }
  ],
  'audio-production': [
    { value: 'studio coordinator', label: 'Studio Coordinator' },
    { value: 'technical director', label: 'Technical Director' },
    { value: 'technical manager', label: 'Technical Manager' },
    { value: 'audio engineer', label: 'Audio Engineer' },
    { value: 'remote recording engineer', label: 'Remote Recording Engineer' },
    { value: 'post production engineer', label: 'Post Production Engineer' }
  ],
  'audio-post-production': [
    { value: 'audio editor', label: 'Audio Editor' },
    { value: 'sound designer', label: 'Sound Designer' },
    { value: 'foley artist', label: 'Foley Artist' },
    { value: 'composer', label: 'Composer' },
    { value: 'theme music', label: 'Theme Music' },
    { value: 'music production', label: 'Music Production' },
    { value: 'music contributor', label: 'Music Contributor' }
  ],
  'administration': [
    { value: 'production coordinator', label: 'Production Coordinator' },
    { value: 'booking coordinator', label: 'Booking Coordinator' },
    { value: 'production assistant', label: 'Production Assistant' },
    { value: 'content manager', label: 'Content Manager' },
    { value: 'marketing manager', label: 'Marketing Manager' },
    { value: 'sales representative', label: 'Sales Representative' },
    { value: 'sales manager', label: 'Sales Manager' }
  ],
  'visuals': [
    { value: 'graphic designer', label: 'Graphic Designer' },
    { value: 'cover art designer', label: 'Cover Art Designer' }
  ],
  'community': [
    { value: 'social media manager', label: 'Social Media Manager' }
  ],
  'misc': [
    { value: 'consultant', label: 'Consultant' },
    { value: 'intern', label: 'Intern' }
  ],
  'video-production': [
    { value: 'camera operator', label: 'Camera Operator' },
    { value: 'lighting designer', label: 'Lighting Designer' },
    { value: 'camera grip', label: 'Camera Grip' },
    { value: 'assistant camera', label: 'Assistant Camera' }
  ],
  'video-post-production': [
    { value: 'editor', label: 'Editor' },
    { value: 'assistant editor', label: 'Assistant Editor' }
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
