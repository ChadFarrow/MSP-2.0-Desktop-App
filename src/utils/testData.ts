// Test data generator for development mode
import type { Album, Track, Person, ValueRecipient } from '../types/feed';

/**
 * Generate a fully populated test album for development testing
 */
export function generateTestAlbum(): Album {
  const now = new Date().toUTCString();
  const podcastGuid = crypto.randomUUID();

  const testPersons: Person[] = [
    { name: 'Jane Doe', roles: [{ group: 'music', role: 'vocalist' }], href: 'https://example.com/jane', img: '' },
    { name: 'John Smith', roles: [{ group: 'music', role: 'guitarist' }], href: '', img: '' },
    { name: 'Bob Wilson', roles: [{ group: 'audio-production', role: 'producer' }], href: '', img: '' }
  ];

  const testRecipients: ValueRecipient[] = [
    {
      name: 'Band Wallet',
      address: '03abc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab',
      split: 95,
      type: 'node'
    },
    {
      name: 'Podcast Index',
      address: '03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a',
      split: 1,
      type: 'node'
    },
    {
      name: 'MSP',
      address: 'msp@getalby.com',
      split: 4,
      type: 'lnaddress'
    }
  ];

  const testTracks: Track[] = [
    {
      id: crypto.randomUUID(),
      trackNumber: 1,
      title: 'Opening Track',
      description: 'The first track on the album, setting the tone for what follows.',
      pubDate: now,
      guid: crypto.randomUUID(),
      enclosureUrl: 'https://example.com/audio/track01.mp3',
      enclosureLength: '5242880',
      enclosureType: 'audio/mpeg',
      duration: '3:45',
      explicit: false,
      trackArtUrl: '',
      bannerArtUrl: '',
      transcriptUrl: '',
      transcriptType: 'application/srt',
      overridePersons: false,
      persons: [],
      overrideValue: false,
      value: undefined
    },
    {
      id: crypto.randomUUID(),
      trackNumber: 2,
      title: 'Middle Journey',
      description: 'A reflective piece exploring themes of change and growth.',
      pubDate: now,
      guid: crypto.randomUUID(),
      enclosureUrl: 'https://example.com/audio/track02.mp3',
      enclosureLength: '6291456',
      enclosureType: 'audio/mpeg',
      duration: '4:32',
      explicit: false,
      trackArtUrl: '',
      bannerArtUrl: '',
      transcriptUrl: '',
      transcriptType: 'application/srt',
      overridePersons: false,
      persons: [],
      overrideValue: false,
      value: undefined
    },
    {
      id: crypto.randomUUID(),
      trackNumber: 3,
      title: 'Final Destination',
      description: 'The closing track bringing everything together in a powerful finale.',
      pubDate: now,
      guid: crypto.randomUUID(),
      enclosureUrl: 'https://example.com/audio/track03.mp3',
      enclosureLength: '7340032',
      enclosureType: 'audio/mpeg',
      duration: '5:18',
      explicit: false,
      trackArtUrl: '',
      bannerArtUrl: '',
      transcriptUrl: '',
      transcriptType: 'application/srt',
      overridePersons: false,
      persons: [],
      overrideValue: false,
      value: undefined
    }
  ];

  return {
    title: 'Test Album',
    author: 'Test Artist',
    description: 'This is a test album generated for development purposes. It contains sample tracks and metadata to test all feed features.',
    link: 'https://example.com/test-album',
    language: 'en',
    generator: 'MSP 2.0 - Music Side Project Studio',
    pubDate: now,
    lastBuildDate: now,
    podcastGuid,
    medium: 'music',
    locked: false,
    lockedOwner: 'test@example.com',
    categories: ['Music'],
    keywords: 'test, sample, demo, music',
    explicit: false,
    ownerName: 'Test Owner',
    ownerEmail: 'owner@example.com',
    imageUrl: 'https://picsum.photos/1400/1400',
    imageTitle: 'Test Album Cover',
    imageLink: 'https://example.com/test-album',
    imageDescription: 'Album artwork for Test Album',
    bannerArtUrl: '',
    managingEditor: 'editor@example.com',
    webMaster: 'webmaster@example.com',
    persons: testPersons,
    value: {
      type: 'lightning',
      method: 'keysend',
      suggested: '0.000033333',
      recipients: testRecipients
    },
    funding: [
      { url: 'https://example.com/support', text: 'Support the band' }
    ],
    op3: false,
    tracks: testTracks
  };
}
