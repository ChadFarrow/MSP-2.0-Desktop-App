import { describe, it, expect, vi, beforeEach } from 'vitest';
import { feedReducer } from './feedStore';
import type { FeedState, FeedAction } from './feedStore';
import {
  createEmptyAlbum,
  createEmptyTrack,
  createEmptyPerson,
  createEmptyRecipient,
  createEmptyFunding,
  createEmptyPublisherFeed,
  createEmptyRemoteItem,
  createEmptyVideoAlbum,
  createSupportRecipients,
} from '../types/feed';

// Mock storage modules that feedReducer calls
vi.mock('../utils/storage', () => ({
  albumStorage: { load: () => null, save: vi.fn() },
  videoStorage: { load: () => null, save: vi.fn() },
  publisherStorage: { load: () => null, save: vi.fn() },
  feedTypeStorage: { load: () => 'album' as const, save: vi.fn() },
}));

vi.mock('../utils/desktopStorage', () => ({
  saveToDesktop: vi.fn(),
  loadFromDesktop: vi.fn(),
  DESKTOP_KEYS: {},
}));

vi.mock('../utils/api', () => ({
  isTauri: () => false,
  apiFetch: vi.fn(),
}));

vi.mock('../utils/hostedFeed', () => ({
  hydrateHostedCredentials: vi.fn(),
}));

vi.mock('../utils/nostr', () => ({
  hydrateNostrUser: vi.fn(),
}));

function makeState(overrides?: Partial<FeedState>): FeedState {
  return {
    feedType: 'album',
    album: createEmptyAlbum(),
    videoFeed: null,
    publisherFeed: null,
    isDirty: false,
    ...overrides,
  };
}

describe('feedReducer', () => {
  let state: FeedState;

  beforeEach(() => {
    state = makeState();
  });

  // --- Album CRUD ---
  describe('Album CRUD', () => {
    it('SET_ALBUM replaces album and sets feedType to album', () => {
      const album = createEmptyAlbum();
      album.title = 'New Album';
      const next = feedReducer(state, { type: 'SET_ALBUM', payload: album });
      expect(next.album.title).toBe('New Album');
      expect(next.feedType).toBe('album');
      expect(next.isDirty).toBe(false);
    });

    it('UPDATE_ALBUM merges partial data and sets isDirty', () => {
      const next = feedReducer(state, { type: 'UPDATE_ALBUM', payload: { title: 'Updated' } });
      expect(next.album.title).toBe('Updated');
      expect(next.isDirty).toBe(true);
    });

    it('UPDATE_ALBUM works on video feed when feedType is video', () => {
      const videoState = makeState({
        feedType: 'video',
        videoFeed: createEmptyVideoAlbum(),
      });
      const next = feedReducer(videoState, { type: 'UPDATE_ALBUM', payload: { title: 'Video Title' } });
      expect(next.videoFeed?.title).toBe('Video Title');
      expect(next.isDirty).toBe(true);
    });
  });

  // --- Person management ---
  describe('Person management', () => {
    it('ADD_PERSON adds a default empty person', () => {
      const next = feedReducer(state, { type: 'ADD_PERSON' });
      expect(next.album.persons).toHaveLength(1);
      expect(next.album.persons[0].name).toBe('');
      expect(next.album.persons[0].roles).toHaveLength(1);
    });

    it('ADD_PERSON adds a custom person', () => {
      const person = { ...createEmptyPerson(), name: 'Alice' };
      const next = feedReducer(state, { type: 'ADD_PERSON', payload: person });
      expect(next.album.persons[0].name).toBe('Alice');
    });

    it('UPDATE_PERSON updates person at index', () => {
      const s = makeState();
      s.album.persons = [createEmptyPerson()];
      const updated = { ...s.album.persons[0], name: 'Bob' };
      const next = feedReducer(s, { type: 'UPDATE_PERSON', payload: { index: 0, person: updated } });
      expect(next.album.persons[0].name).toBe('Bob');
    });

    it('REMOVE_PERSON removes person at index', () => {
      const s = makeState();
      s.album.persons = [createEmptyPerson(), { ...createEmptyPerson(), name: 'Keep' }];
      const next = feedReducer(s, { type: 'REMOVE_PERSON', payload: 0 });
      expect(next.album.persons).toHaveLength(1);
      expect(next.album.persons[0].name).toBe('Keep');
    });

    it('ADD_PERSON_ROLE adds a role to a person', () => {
      const s = makeState();
      s.album.persons = [createEmptyPerson()];
      const next = feedReducer(s, {
        type: 'ADD_PERSON_ROLE',
        payload: { personIndex: 0, role: { group: 'cast', role: 'host' } },
      });
      expect(next.album.persons[0].roles).toHaveLength(2);
      expect(next.album.persons[0].roles[1]).toEqual({ group: 'cast', role: 'host' });
    });

    it('UPDATE_PERSON_ROLE updates a specific role', () => {
      const s = makeState();
      s.album.persons = [createEmptyPerson()];
      const next = feedReducer(s, {
        type: 'UPDATE_PERSON_ROLE',
        payload: { personIndex: 0, roleIndex: 0, role: { group: 'writing', role: 'songwriter' } },
      });
      expect(next.album.persons[0].roles[0]).toEqual({ group: 'writing', role: 'songwriter' });
    });

    it('REMOVE_PERSON_ROLE removes a role (only if >1 remain)', () => {
      const s = makeState();
      const person = createEmptyPerson();
      person.roles.push({ group: 'cast', role: 'host' });
      s.album.persons = [person];
      const next = feedReducer(s, {
        type: 'REMOVE_PERSON_ROLE',
        payload: { personIndex: 0, roleIndex: 0 },
      });
      expect(next.album.persons[0].roles).toHaveLength(1);
      expect(next.album.persons[0].roles[0]).toEqual({ group: 'cast', role: 'host' });
    });

    it('REMOVE_PERSON_ROLE does not remove last role', () => {
      const s = makeState();
      s.album.persons = [createEmptyPerson()]; // only 1 role
      const next = feedReducer(s, {
        type: 'REMOVE_PERSON_ROLE',
        payload: { personIndex: 0, roleIndex: 0 },
      });
      expect(next.album.persons[0].roles).toHaveLength(1);
    });
  });

  // --- Recipient management ---
  describe('Recipient management', () => {
    it('ADD_RECIPIENT adds an empty recipient', () => {
      const next = feedReducer(state, { type: 'ADD_RECIPIENT' });
      // Should have original empty + new empty
      expect(next.album.value.recipients.length).toBeGreaterThanOrEqual(1);
    });

    it('ADD_RECIPIENT with address auto-adds community support recipients', () => {
      const s = makeState();
      s.album.value.recipients = []; // start empty
      const recipient = { ...createEmptyRecipient(), name: 'Artist', address: 'artist@getalby.com', split: 90 };
      const next = feedReducer(s, { type: 'ADD_RECIPIENT', payload: recipient });
      // Should have: artist + MSP 2.0 + Podcastindex.org
      expect(next.album.value.recipients).toHaveLength(3);
      expect(next.album.value.recipients[0].name).toBe('Artist');
      expect(next.album.value.recipients[1].name).toBe('MSP 2.0');
      expect(next.album.value.recipients[2].name).toBe('Podcastindex.org');
    });

    it('ADD_RECIPIENT does not re-add support recipients if user already has them', () => {
      const s = makeState();
      const support = createSupportRecipients();
      s.album.value.recipients = [
        { ...createEmptyRecipient(), name: 'Existing', address: 'existing@test.com', split: 50 },
        ...support,
      ];
      const newR = { ...createEmptyRecipient(), name: 'Another', address: 'another@test.com', split: 30 };
      const next = feedReducer(s, { type: 'ADD_RECIPIENT', payload: newR });
      // Should not duplicate support recipients
      const supportCount = next.album.value.recipients.filter(r => r.name === 'MSP 2.0').length;
      expect(supportCount).toBe(1);
    });

    it('UPDATE_RECIPIENT updates recipient at index', () => {
      const s = makeState();
      s.album.value.recipients = [createEmptyRecipient()];
      const updated = { ...createEmptyRecipient(), name: 'Updated', address: 'test@test.com', split: 50 };
      const next = feedReducer(s, { type: 'UPDATE_RECIPIENT', payload: { index: 0, recipient: updated } });
      expect(next.album.value.recipients[0].name).toBe('Updated');
    });

    it('UPDATE_RECIPIENT auto-adds support when first address is filled', () => {
      const s = makeState();
      s.album.value.recipients = [createEmptyRecipient()];
      const updated = { ...createEmptyRecipient(), name: 'Artist', address: 'artist@getalby.com', split: 90 };
      const next = feedReducer(s, { type: 'UPDATE_RECIPIENT', payload: { index: 0, recipient: updated } });
      expect(next.album.value.recipients.length).toBeGreaterThanOrEqual(3);
    });

    it('REMOVE_RECIPIENT removes recipient at index', () => {
      const s = makeState();
      s.album.value.recipients = [
        { ...createEmptyRecipient(), name: 'A', address: 'a@test.com' },
        { ...createEmptyRecipient(), name: 'B', address: 'b@test.com' },
      ];
      const next = feedReducer(s, { type: 'REMOVE_RECIPIENT', payload: 0 });
      expect(next.album.value.recipients).toHaveLength(1);
      expect(next.album.value.recipients[0].name).toBe('B');
    });
  });

  // --- Track management ---
  describe('Track management', () => {
    it('ADD_TRACK adds a default track with correct number', () => {
      const next = feedReducer(state, { type: 'ADD_TRACK' });
      expect(next.album.tracks).toHaveLength(2);
      expect(next.album.tracks[1].trackNumber).toBe(2);
    });

    it('ADD_TRACK adds a custom track', () => {
      const track = createEmptyTrack(5);
      track.title = 'Custom Track';
      const next = feedReducer(state, { type: 'ADD_TRACK', payload: track });
      expect(next.album.tracks[1].title).toBe('Custom Track');
    });

    it('UPDATE_TRACK updates track at index', () => {
      const next = feedReducer(state, {
        type: 'UPDATE_TRACK',
        payload: { index: 0, track: { title: 'New Title' } },
      });
      expect(next.album.tracks[0].title).toBe('New Title');
    });

    it('REMOVE_TRACK removes track and renumbers', () => {
      const s = makeState();
      s.album.tracks = [createEmptyTrack(1), createEmptyTrack(2), createEmptyTrack(3)];
      s.album.tracks[0].title = 'First';
      s.album.tracks[1].title = 'Second';
      s.album.tracks[2].title = 'Third';
      const next = feedReducer(s, { type: 'REMOVE_TRACK', payload: 1 });
      expect(next.album.tracks).toHaveLength(2);
      expect(next.album.tracks[0].title).toBe('First');
      expect(next.album.tracks[1].title).toBe('Third');
      expect(next.album.tracks[0].trackNumber).toBe(1);
      expect(next.album.tracks[1].trackNumber).toBe(2);
    });

    it('REORDER_TRACKS moves track and renumbers', () => {
      const s = makeState();
      s.album.tracks = [createEmptyTrack(1), createEmptyTrack(2), createEmptyTrack(3)];
      s.album.tracks[0].title = 'A';
      s.album.tracks[1].title = 'B';
      s.album.tracks[2].title = 'C';
      const next = feedReducer(s, { type: 'REORDER_TRACKS', payload: { fromIndex: 0, toIndex: 2 } });
      expect(next.album.tracks[0].title).toBe('B');
      expect(next.album.tracks[1].title).toBe('C');
      expect(next.album.tracks[2].title).toBe('A');
      // Track numbers and episodes should be renumbered
      expect(next.album.tracks[0].trackNumber).toBe(1);
      expect(next.album.tracks[1].trackNumber).toBe(2);
      expect(next.album.tracks[2].trackNumber).toBe(3);
    });
  });

  // --- Track-level person and recipient operations ---
  describe('Track-level operations', () => {
    it('ADD_TRACK_PERSON adds person to track', () => {
      const next = feedReducer(state, {
        type: 'ADD_TRACK_PERSON',
        payload: { trackIndex: 0 },
      });
      expect(next.album.tracks[0].persons).toHaveLength(1);
    });

    it('UPDATE_TRACK_PERSON updates person on track', () => {
      const s = makeState();
      s.album.tracks[0].persons = [createEmptyPerson()];
      const updated = { ...createEmptyPerson(), name: 'Track Person' };
      const next = feedReducer(s, {
        type: 'UPDATE_TRACK_PERSON',
        payload: { trackIndex: 0, personIndex: 0, person: updated },
      });
      expect(next.album.tracks[0].persons[0].name).toBe('Track Person');
    });

    it('REMOVE_TRACK_PERSON removes person from track', () => {
      const s = makeState();
      s.album.tracks[0].persons = [createEmptyPerson(), { ...createEmptyPerson(), name: 'Keep' }];
      const next = feedReducer(s, {
        type: 'REMOVE_TRACK_PERSON',
        payload: { trackIndex: 0, personIndex: 0 },
      });
      expect(next.album.tracks[0].persons).toHaveLength(1);
      expect(next.album.tracks[0].persons[0].name).toBe('Keep');
    });

    it('ADD_TRACK_RECIPIENT adds recipient to track', () => {
      const s = makeState();
      s.album.tracks[0].value = { type: 'lightning', method: 'keysend', recipients: [] };
      const next = feedReducer(s, {
        type: 'ADD_TRACK_RECIPIENT',
        payload: { trackIndex: 0 },
      });
      expect(next.album.tracks[0].value?.recipients).toHaveLength(1);
    });

    it('ADD_TRACK_RECIPIENT with address auto-adds support recipients', () => {
      const s = makeState();
      s.album.tracks[0].value = { type: 'lightning', method: 'keysend', recipients: [] };
      const recipient = { ...createEmptyRecipient(), name: 'Artist', address: 'artist@test.com', split: 90 };
      const next = feedReducer(s, {
        type: 'ADD_TRACK_RECIPIENT',
        payload: { trackIndex: 0, recipient },
      });
      expect(next.album.tracks[0].value?.recipients.length).toBe(3);
    });

    it('UPDATE_TRACK_RECIPIENT updates recipient on track', () => {
      const s = makeState();
      s.album.tracks[0].value = {
        type: 'lightning',
        method: 'keysend',
        recipients: [createEmptyRecipient()],
      };
      const updated = { ...createEmptyRecipient(), name: 'Updated', address: 'x@y.com', split: 50 };
      const next = feedReducer(s, {
        type: 'UPDATE_TRACK_RECIPIENT',
        payload: { trackIndex: 0, recipientIndex: 0, recipient: updated },
      });
      expect(next.album.tracks[0].value?.recipients[0].name).toBe('Updated');
    });

    it('REMOVE_TRACK_RECIPIENT removes recipient from track', () => {
      const s = makeState();
      s.album.tracks[0].value = {
        type: 'lightning',
        method: 'keysend',
        recipients: [
          { ...createEmptyRecipient(), name: 'A' },
          { ...createEmptyRecipient(), name: 'B' },
        ],
      };
      const next = feedReducer(s, {
        type: 'REMOVE_TRACK_RECIPIENT',
        payload: { trackIndex: 0, recipientIndex: 0 },
      });
      expect(next.album.tracks[0].value?.recipients).toHaveLength(1);
      expect(next.album.tracks[0].value?.recipients[0].name).toBe('B');
    });
  });

  // --- Funding ---
  describe('Funding', () => {
    it('ADD_FUNDING adds a default funding entry', () => {
      const next = feedReducer(state, { type: 'ADD_FUNDING' });
      expect(next.album.funding).toHaveLength(1);
    });

    it('ADD_FUNDING adds a custom funding entry', () => {
      const funding = { url: 'https://donate.example.com', text: 'Donate' };
      const next = feedReducer(state, { type: 'ADD_FUNDING', payload: funding });
      expect(next.album.funding[0].url).toBe('https://donate.example.com');
    });

    it('UPDATE_FUNDING updates funding at index', () => {
      const s = makeState();
      s.album.funding = [createEmptyFunding()];
      const next = feedReducer(s, {
        type: 'UPDATE_FUNDING',
        payload: { index: 0, funding: { url: 'https://new.com', text: 'New' } },
      });
      expect(next.album.funding[0].url).toBe('https://new.com');
    });

    it('REMOVE_FUNDING removes funding at index', () => {
      const s = makeState();
      s.album.funding = [
        { url: 'a', text: 'A' },
        { url: 'b', text: 'B' },
      ];
      const next = feedReducer(s, { type: 'REMOVE_FUNDING', payload: 0 });
      expect(next.album.funding).toHaveLength(1);
      expect(next.album.funding[0].text).toBe('B');
    });
  });

  // --- Feed type switching ---
  describe('Feed type switching', () => {
    it('SET_FEED_TYPE changes feedType', () => {
      const next = feedReducer(state, { type: 'SET_FEED_TYPE', payload: 'video' });
      expect(next.feedType).toBe('video');
    });

    it('SET_VIDEO_FEED sets video feed and changes feedType', () => {
      const video = createEmptyVideoAlbum();
      video.title = 'My Video';
      const next = feedReducer(state, { type: 'SET_VIDEO_FEED', payload: video });
      expect(next.videoFeed?.title).toBe('My Video');
      expect(next.feedType).toBe('video');
      expect(next.isDirty).toBe(false);
    });

    it('UPDATE_VIDEO_FEED updates video feed', () => {
      const s = makeState({ feedType: 'video', videoFeed: createEmptyVideoAlbum() });
      const next = feedReducer(s, { type: 'UPDATE_VIDEO_FEED', payload: { title: 'Updated Video' } });
      expect(next.videoFeed?.title).toBe('Updated Video');
      expect(next.isDirty).toBe(true);
    });

    it('UPDATE_VIDEO_FEED does nothing when videoFeed is null', () => {
      const next = feedReducer(state, { type: 'UPDATE_VIDEO_FEED', payload: { title: 'X' } });
      expect(next.videoFeed).toBeNull();
    });

    it('CREATE_NEW_VIDEO_FEED creates a new video feed', () => {
      const next = feedReducer(state, { type: 'CREATE_NEW_VIDEO_FEED' });
      expect(next.videoFeed).not.toBeNull();
      expect(next.videoFeed?.medium).toBe('video');
      expect(next.feedType).toBe('video');
    });
  });

  // --- Publisher feed actions ---
  describe('Publisher feed actions', () => {
    it('SET_PUBLISHER_FEED sets publisher feed and changes feedType', () => {
      const pub = createEmptyPublisherFeed();
      pub.title = 'My Label';
      const next = feedReducer(state, { type: 'SET_PUBLISHER_FEED', payload: pub });
      expect(next.publisherFeed?.title).toBe('My Label');
      expect(next.feedType).toBe('publisher');
      expect(next.isDirty).toBe(false);
    });

    it('UPDATE_PUBLISHER_FEED updates publisher feed', () => {
      const s = makeState({ feedType: 'publisher', publisherFeed: createEmptyPublisherFeed() });
      const next = feedReducer(s, { type: 'UPDATE_PUBLISHER_FEED', payload: { title: 'Updated' } });
      expect(next.publisherFeed?.title).toBe('Updated');
      expect(next.isDirty).toBe(true);
    });

    it('UPDATE_PUBLISHER_FEED does nothing when publisherFeed is null', () => {
      const next = feedReducer(state, { type: 'UPDATE_PUBLISHER_FEED', payload: { title: 'X' } });
      expect(next.publisherFeed).toBeNull();
    });

    it('ADD_REMOTE_ITEM adds a remote item', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      const next = feedReducer(s, { type: 'ADD_REMOTE_ITEM' });
      expect(next.publisherFeed?.remoteItems).toHaveLength(1);
    });

    it('ADD_REMOTE_ITEM adds a custom remote item', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      const item = { ...createEmptyRemoteItem(), feedGuid: 'abc-123', title: 'Album' };
      const next = feedReducer(s, { type: 'ADD_REMOTE_ITEM', payload: item });
      expect(next.publisherFeed?.remoteItems[0].feedGuid).toBe('abc-123');
    });

    it('UPDATE_REMOTE_ITEM updates item at index', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.remoteItems = [createEmptyRemoteItem()];
      const updated = { ...createEmptyRemoteItem(), feedGuid: 'xyz', title: 'Updated' };
      const next = feedReducer(s, { type: 'UPDATE_REMOTE_ITEM', payload: { index: 0, item: updated } });
      expect(next.publisherFeed?.remoteItems[0].feedGuid).toBe('xyz');
    });

    it('REMOVE_REMOTE_ITEM removes item at index', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.remoteItems = [
        { ...createEmptyRemoteItem(), title: 'A' },
        { ...createEmptyRemoteItem(), title: 'B' },
      ];
      const next = feedReducer(s, { type: 'REMOVE_REMOTE_ITEM', payload: 0 });
      expect(next.publisherFeed?.remoteItems).toHaveLength(1);
      expect(next.publisherFeed?.remoteItems[0].title).toBe('B');
    });

    it('REORDER_REMOTE_ITEMS reorders items', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.remoteItems = [
        { ...createEmptyRemoteItem(), title: 'A' },
        { ...createEmptyRemoteItem(), title: 'B' },
        { ...createEmptyRemoteItem(), title: 'C' },
      ];
      const next = feedReducer(s, { type: 'REORDER_REMOTE_ITEMS', payload: { fromIndex: 2, toIndex: 0 } });
      expect(next.publisherFeed?.remoteItems[0].title).toBe('C');
      expect(next.publisherFeed?.remoteItems[1].title).toBe('A');
      expect(next.publisherFeed?.remoteItems[2].title).toBe('B');
    });

    it('CREATE_NEW_PUBLISHER_FEED creates empty publisher feed', () => {
      const next = feedReducer(state, { type: 'CREATE_NEW_PUBLISHER_FEED' });
      expect(next.publisherFeed).not.toBeNull();
      expect(next.publisherFeed?.medium).toBe('publisher');
      expect(next.feedType).toBe('publisher');
    });

    it('ADD_PUBLISHER_RECIPIENT adds recipient with auto-support', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.value.recipients = [];
      const recipient = { ...createEmptyRecipient(), name: 'Label', address: 'label@test.com', split: 90 };
      const next = feedReducer(s, { type: 'ADD_PUBLISHER_RECIPIENT', payload: recipient });
      expect(next.publisherFeed?.value.recipients.length).toBe(3);
    });

    it('UPDATE_PUBLISHER_RECIPIENT updates recipient', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.value.recipients = [createEmptyRecipient()];
      const updated = { ...createEmptyRecipient(), name: 'Updated', address: 'u@t.com', split: 50 };
      const next = feedReducer(s, {
        type: 'UPDATE_PUBLISHER_RECIPIENT',
        payload: { index: 0, recipient: updated },
      });
      expect(next.publisherFeed?.value.recipients[0].name).toBe('Updated');
    });

    it('REMOVE_PUBLISHER_RECIPIENT removes recipient', () => {
      const s = makeState({ publisherFeed: createEmptyPublisherFeed() });
      s.publisherFeed!.value.recipients = [
        { ...createEmptyRecipient(), name: 'A' },
        { ...createEmptyRecipient(), name: 'B' },
      ];
      const next = feedReducer(s, { type: 'REMOVE_PUBLISHER_RECIPIENT', payload: 0 });
      expect(next.publisherFeed?.value.recipients).toHaveLength(1);
      expect(next.publisherFeed?.value.recipients[0].name).toBe('B');
    });
  });

  // --- RESET ---
  describe('RESET', () => {
    it('RESET returns to initial state', () => {
      const s = makeState();
      s.album.title = 'Modified';
      s.isDirty = true;
      const next = feedReducer(s, { type: 'RESET' });
      expect(next.isDirty).toBe(false);
      expect(next.feedType).toBe('album');
    });
  });

  // --- Unknown action ---
  describe('Unknown action', () => {
    it('returns state unchanged for unknown action type', () => {
      const next = feedReducer(state, { type: 'UNKNOWN_ACTION' } as unknown as FeedAction);
      expect(next).toBe(state);
    });
  });
});
