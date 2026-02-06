// MSP 2.0 - Feed State Management (React Context)
import { createContext, useContext, useReducer, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Album, Track, Person, PersonRole, ValueRecipient, Funding, PublisherFeed, RemoteItem } from '../types/feed';
import { createEmptyAlbum, createEmptyTrack, createEmptyPerson, createEmptyPersonRole, createEmptyRecipient, createEmptyFunding, createEmptyPublisherFeed, createEmptyRemoteItem, createEmptyVideoAlbum, createSupportRecipients } from '../types/feed';
import { albumStorage, videoStorage, publisherStorage, feedTypeStorage } from '../utils/storage';

// Community support recipients - identified by both name AND address
const COMMUNITY_SUPPORT_RECIPIENTS = [
  { name: 'MSP 2.0', address: 'chadf@getalby.com' },
  { name: 'Podcastindex.org', address: 'podcastindex@getalby.com' },
];

const isCommunitySupport = (r: ValueRecipient): boolean =>
  COMMUNITY_SUPPORT_RECIPIENTS.some(cs => cs.name === r.name && cs.address === r.address);

// Check if recipients have any user-added (non-support, non-empty) recipients
const hasUserRecipients = (recipients: ValueRecipient[]): boolean =>
  recipients.some(r => r.address && !isCommunitySupport(r));

// Feed type enum
export type FeedType = 'album' | 'video' | 'publisher';

// Action types
export type FeedAction =
  | { type: 'SET_ALBUM'; payload: Album }
  | { type: 'UPDATE_ALBUM'; payload: Partial<Album> }
  | { type: 'ADD_PERSON'; payload?: Person }
  | { type: 'UPDATE_PERSON'; payload: { index: number; person: Person } }
  | { type: 'REMOVE_PERSON'; payload: number }
  | { type: 'ADD_PERSON_ROLE'; payload: { personIndex: number; role?: PersonRole } }
  | { type: 'UPDATE_PERSON_ROLE'; payload: { personIndex: number; roleIndex: number; role: PersonRole } }
  | { type: 'REMOVE_PERSON_ROLE'; payload: { personIndex: number; roleIndex: number } }
  | { type: 'ADD_RECIPIENT'; payload?: ValueRecipient }
  | { type: 'UPDATE_RECIPIENT'; payload: { index: number; recipient: ValueRecipient } }
  | { type: 'REMOVE_RECIPIENT'; payload: number }
  | { type: 'ADD_FUNDING'; payload?: Funding }
  | { type: 'UPDATE_FUNDING'; payload: { index: number; funding: Funding } }
  | { type: 'REMOVE_FUNDING'; payload: number }
  | { type: 'ADD_TRACK'; payload?: Track }
  | { type: 'UPDATE_TRACK'; payload: { index: number; track: Partial<Track> } }
  | { type: 'REMOVE_TRACK'; payload: number }
  | { type: 'REORDER_TRACKS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'ADD_TRACK_PERSON'; payload: { trackIndex: number; person?: Person } }
  | { type: 'UPDATE_TRACK_PERSON'; payload: { trackIndex: number; personIndex: number; person: Person } }
  | { type: 'REMOVE_TRACK_PERSON'; payload: { trackIndex: number; personIndex: number } }
  | { type: 'ADD_TRACK_RECIPIENT'; payload: { trackIndex: number; recipient?: ValueRecipient } }
  | { type: 'UPDATE_TRACK_RECIPIENT'; payload: { trackIndex: number; recipientIndex: number; recipient: ValueRecipient } }
  | { type: 'REMOVE_TRACK_RECIPIENT'; payload: { trackIndex: number; recipientIndex: number } }
  | { type: 'RESET' }
  // Publisher feed actions
  | { type: 'SET_FEED_TYPE'; payload: FeedType }
  | { type: 'SET_PUBLISHER_FEED'; payload: PublisherFeed }
  | { type: 'UPDATE_PUBLISHER_FEED'; payload: Partial<PublisherFeed> }
  | { type: 'ADD_REMOTE_ITEM'; payload?: RemoteItem }
  | { type: 'UPDATE_REMOTE_ITEM'; payload: { index: number; item: RemoteItem } }
  | { type: 'REMOVE_REMOTE_ITEM'; payload: number }
  | { type: 'REORDER_REMOTE_ITEMS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'CREATE_NEW_PUBLISHER_FEED' }
  | { type: 'ADD_PUBLISHER_RECIPIENT'; payload?: ValueRecipient }
  | { type: 'UPDATE_PUBLISHER_RECIPIENT'; payload: { index: number; recipient: ValueRecipient } }
  | { type: 'REMOVE_PUBLISHER_RECIPIENT'; payload: number }
  // Video feed actions
  | { type: 'SET_VIDEO_FEED'; payload: Album }
  | { type: 'UPDATE_VIDEO_FEED'; payload: Partial<Album> }
  | { type: 'CREATE_NEW_VIDEO_FEED' };

// State interface
interface FeedState {
  feedType: FeedType;
  album: Album;
  videoFeed: Album | null;
  publisherFeed: PublisherFeed | null;
  isDirty: boolean;
}


// Initial state - try to load from localStorage first
const initialState: FeedState = {
  feedType: feedTypeStorage.load(),
  album: albumStorage.load() || createEmptyAlbum(),
  videoFeed: videoStorage.load() || null,
  publisherFeed: publisherStorage.load() || null,
  isDirty: false
};

// Helper to get the current active album (album or videoFeed based on feedType)
function getActiveAlbum(state: FeedState): Album {
  if (state.feedType === 'video' && state.videoFeed) {
    return state.videoFeed;
  }
  return state.album;
}

// Helper to update the correct feed based on feedType
function updateActiveFeed(state: FeedState, albumUpdate: Album): FeedState {
  if (state.feedType === 'video') {
    return { ...state, videoFeed: albumUpdate, isDirty: true };
  }
  return { ...state, album: albumUpdate, isDirty: true };
}

// Reducer
function feedReducer(state: FeedState, action: FeedAction): FeedState {
  // Get the active album for actions that work on the current feed
  const activeAlbum = getActiveAlbum(state);

  switch (action.type) {
    case 'SET_ALBUM':
      feedTypeStorage.save('album');
      return { ...state, album: action.payload, feedType: 'album', isDirty: false };

    case 'UPDATE_ALBUM':
      return updateActiveFeed(state, { ...activeAlbum, ...action.payload });

    case 'ADD_PERSON':
      return updateActiveFeed(state, {
        ...activeAlbum,
        persons: [...activeAlbum.persons, action.payload || createEmptyPerson()]
      });

    case 'UPDATE_PERSON':
      return updateActiveFeed(state, {
        ...activeAlbum,
        persons: activeAlbum.persons.map((p, i) =>
          i === action.payload.index ? action.payload.person : p
        )
      });

    case 'REMOVE_PERSON':
      return updateActiveFeed(state, {
        ...activeAlbum,
        persons: activeAlbum.persons.filter((_, i) => i !== action.payload)
      });

    case 'ADD_PERSON_ROLE': {
      const persons = [...activeAlbum.persons];
      const person = persons[action.payload.personIndex];
      if (person) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: [...person.roles, action.payload.role || createEmptyPersonRole()]
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, persons });
    }

    case 'UPDATE_PERSON_ROLE': {
      const persons = [...activeAlbum.persons];
      const person = persons[action.payload.personIndex];
      if (person) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: person.roles.map((r, i) =>
            i === action.payload.roleIndex ? action.payload.role : r
          )
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, persons });
    }

    case 'REMOVE_PERSON_ROLE': {
      const persons = [...activeAlbum.persons];
      const person = persons[action.payload.personIndex];
      if (person && person.roles.length > 1) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: person.roles.filter((_, i) => i !== action.payload.roleIndex)
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, persons });
    }

    case 'ADD_RECIPIENT': {
      const newRecipient = action.payload || createEmptyRecipient();
      const currentRecipients = activeAlbum.value.recipients;
      // Filter out empty placeholder recipients when adding a real one
      const filteredRecipients = newRecipient.address
        ? currentRecipients.filter(r => r.address)
        : currentRecipients;
      // Auto-add support recipients if this is the first user recipient
      const shouldAddSupport = newRecipient.address &&
        !isCommunitySupport(newRecipient) &&
        !hasUserRecipients(currentRecipients);
      const newRecipients = shouldAddSupport
        ? [...filteredRecipients, newRecipient, ...createSupportRecipients()]
        : [...filteredRecipients, newRecipient];
      return updateActiveFeed(state, {
        ...activeAlbum,
        value: {
          ...activeAlbum.value,
          recipients: newRecipients
        }
      });
    }

    case 'UPDATE_RECIPIENT': {
      const updatedRecipient = action.payload.recipient;
      const currentRecipients = activeAlbum.value.recipients;
      const updatedRecipients = currentRecipients.map((r, i) =>
        i === action.payload.index ? updatedRecipient : r
      );
      // Auto-add community support recipients when user fills in their first address
      const hadUserRecipients = hasUserRecipients(currentRecipients);
      const nowHasUserRecipients = hasUserRecipients(updatedRecipients);
      const shouldAddSupport = !hadUserRecipients && nowHasUserRecipients;
      const finalRecipients = shouldAddSupport
        ? [...updatedRecipients, ...createSupportRecipients()]
        : updatedRecipients;
      return updateActiveFeed(state, {
        ...activeAlbum,
        value: {
          ...activeAlbum.value,
          recipients: finalRecipients
        }
      });
    }

    case 'REMOVE_RECIPIENT':
      return updateActiveFeed(state, {
        ...activeAlbum,
        value: {
          ...activeAlbum.value,
          recipients: activeAlbum.value.recipients.filter((_, i) => i !== action.payload)
        }
      });

    case 'ADD_FUNDING':
      return updateActiveFeed(state, {
        ...activeAlbum,
        funding: [...(activeAlbum.funding || []), action.payload || createEmptyFunding()]
      });

    case 'UPDATE_FUNDING':
      return updateActiveFeed(state, {
        ...activeAlbum,
        funding: (activeAlbum.funding || []).map((f, i) =>
          i === action.payload.index ? action.payload.funding : f
        )
      });

    case 'REMOVE_FUNDING':
      return updateActiveFeed(state, {
        ...activeAlbum,
        funding: (activeAlbum.funding || []).filter((_, i) => i !== action.payload)
      });

    case 'ADD_TRACK': {
      const newTrack = action.payload || createEmptyTrack(activeAlbum.tracks.length + 1);
      return updateActiveFeed(state, {
        ...activeAlbum,
        tracks: [...activeAlbum.tracks, newTrack]
      });
    }

    case 'UPDATE_TRACK':
      return updateActiveFeed(state, {
        ...activeAlbum,
        tracks: activeAlbum.tracks.map((t, i) =>
          i === action.payload.index ? { ...t, ...action.payload.track } : t
        )
      });

    case 'REMOVE_TRACK':
      return updateActiveFeed(state, {
        ...activeAlbum,
        tracks: activeAlbum.tracks
          .filter((_, i) => i !== action.payload)
          .map((t, i) => ({ ...t, trackNumber: i + 1 }))
      });

    case 'REORDER_TRACKS': {
      const tracks = [...activeAlbum.tracks];
      const [removed] = tracks.splice(action.payload.fromIndex, 1);
      tracks.splice(action.payload.toIndex, 0, removed);
      return updateActiveFeed(state, {
        ...activeAlbum,
        tracks: tracks.map((t, i) => ({ ...t, trackNumber: i + 1, episode: i + 1 }))
      });
    }

    case 'ADD_TRACK_PERSON': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        tracks[action.payload.trackIndex] = {
          ...track,
          persons: [...track.persons, action.payload.person || createEmptyPerson()]
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'UPDATE_TRACK_PERSON': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        tracks[action.payload.trackIndex] = {
          ...track,
          persons: track.persons.map((p, i) =>
            i === action.payload.personIndex ? action.payload.person : p
          )
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'REMOVE_TRACK_PERSON': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        tracks[action.payload.trackIndex] = {
          ...track,
          persons: track.persons.filter((_, i) => i !== action.payload.personIndex)
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'ADD_TRACK_RECIPIENT': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        const value = track.value || { type: 'lightning' as const, method: 'keysend' as const, recipients: [] };
        const newRecipient = action.payload.recipient || createEmptyRecipient();
        const currentRecipients = value.recipients;
        // Filter out empty placeholder recipients when adding a real one
        const filteredRecipients = newRecipient.address
          ? currentRecipients.filter(r => r.address)
          : currentRecipients;
        // Auto-add support recipients if this is the first user recipient
        const shouldAddSupport = newRecipient.address &&
          !isCommunitySupport(newRecipient) &&
          !hasUserRecipients(currentRecipients);
        const newRecipients = shouldAddSupport
          ? [...filteredRecipients, newRecipient, ...createSupportRecipients()]
          : [...filteredRecipients, newRecipient];
        tracks[action.payload.trackIndex] = {
          ...track,
          value: {
            ...value,
            recipients: newRecipients
          }
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'UPDATE_TRACK_RECIPIENT': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        const updatedRecipient = action.payload.recipient;
        const currentRecipients = track.value.recipients;
        const updatedRecipients = currentRecipients.map((r, i) =>
          i === action.payload.recipientIndex ? updatedRecipient : r
        );
        // Auto-add community support recipients when user fills in their first address
        const hadUserRecipients = hasUserRecipients(currentRecipients);
        const nowHasUserRecipients = hasUserRecipients(updatedRecipients);
        const shouldAddSupport = !hadUserRecipients && nowHasUserRecipients;
        const finalRecipients = shouldAddSupport
          ? [...updatedRecipients, ...createSupportRecipients()]
          : updatedRecipients;
        tracks[action.payload.trackIndex] = {
          ...track,
          value: {
            ...track.value,
            recipients: finalRecipients
          }
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'REMOVE_TRACK_RECIPIENT': {
      const tracks = [...activeAlbum.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        tracks[action.payload.trackIndex] = {
          ...track,
          value: {
            ...track.value,
            recipients: track.value.recipients.filter((_, i) => i !== action.payload.recipientIndex)
          }
        };
      }
      return updateActiveFeed(state, { ...activeAlbum, tracks });
    }

    case 'RESET':
      return initialState;

    // Publisher feed actions
    case 'SET_FEED_TYPE':
      feedTypeStorage.save(action.payload);
      return { ...state, feedType: action.payload };

    case 'SET_PUBLISHER_FEED':
      feedTypeStorage.save('publisher');
      return { ...state, publisherFeed: action.payload, feedType: 'publisher', isDirty: false };

    case 'UPDATE_PUBLISHER_FEED':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: { ...state.publisherFeed, ...action.payload },
        isDirty: true
      };

    case 'ADD_REMOTE_ITEM':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          remoteItems: [...state.publisherFeed.remoteItems, action.payload || createEmptyRemoteItem()]
        },
        isDirty: true
      };

    case 'UPDATE_REMOTE_ITEM':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          remoteItems: state.publisherFeed.remoteItems.map((item, i) =>
            i === action.payload.index ? action.payload.item : item
          )
        },
        isDirty: true
      };

    case 'REMOVE_REMOTE_ITEM':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          remoteItems: state.publisherFeed.remoteItems.filter((_, i) => i !== action.payload)
        },
        isDirty: true
      };

    case 'REORDER_REMOTE_ITEMS': {
      if (!state.publisherFeed) return state;
      const { fromIndex, toIndex } = action.payload;
      const items = [...state.publisherFeed.remoteItems];
      const [removed] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, removed);
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          remoteItems: items
        },
        isDirty: true
      };
    }

    case 'CREATE_NEW_PUBLISHER_FEED':
      feedTypeStorage.save('publisher');
      return {
        ...state,
        publisherFeed: createEmptyPublisherFeed(),
        feedType: 'publisher',
        isDirty: true
      };

    case 'ADD_PUBLISHER_RECIPIENT': {
      if (!state.publisherFeed) return state;
      const newRecipient = action.payload || createEmptyRecipient();
      const currentRecipients = state.publisherFeed.value.recipients;
      // Filter out empty placeholder recipients when adding a real one
      const filteredRecipients = newRecipient.address
        ? currentRecipients.filter(r => r.address)
        : currentRecipients;
      // Auto-add support recipients if this is the first user recipient
      const shouldAddSupport = newRecipient.address &&
        !isCommunitySupport(newRecipient) &&
        !hasUserRecipients(currentRecipients);
      const newRecipients = shouldAddSupport
        ? [...filteredRecipients, newRecipient, ...createSupportRecipients()]
        : [...filteredRecipients, newRecipient];
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          value: {
            ...state.publisherFeed.value,
            recipients: newRecipients
          }
        },
        isDirty: true
      };
    }

    case 'UPDATE_PUBLISHER_RECIPIENT': {
      if (!state.publisherFeed) return state;
      const updatedRecipient = action.payload.recipient;
      const currentRecipients = state.publisherFeed.value.recipients;
      const updatedRecipients = currentRecipients.map((r, i) =>
        i === action.payload.index ? updatedRecipient : r
      );
      // Auto-add community support recipients when user fills in their first address
      const hadUserRecipients = hasUserRecipients(currentRecipients);
      const nowHasUserRecipients = hasUserRecipients(updatedRecipients);
      const shouldAddSupport = !hadUserRecipients && nowHasUserRecipients;
      const finalRecipients = shouldAddSupport
        ? [...updatedRecipients, ...createSupportRecipients()]
        : updatedRecipients;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          value: {
            ...state.publisherFeed.value,
            recipients: finalRecipients
          }
        },
        isDirty: true
      };
    }

    case 'REMOVE_PUBLISHER_RECIPIENT':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          value: {
            ...state.publisherFeed.value,
            recipients: state.publisherFeed.value.recipients.filter((_, i) => i !== action.payload)
          }
        },
        isDirty: true
      };

    // Video feed actions
    case 'SET_VIDEO_FEED':
      feedTypeStorage.save('video');
      return { ...state, videoFeed: action.payload, feedType: 'video', isDirty: false };

    case 'UPDATE_VIDEO_FEED':
      if (!state.videoFeed) return state;
      return {
        ...state,
        videoFeed: { ...state.videoFeed, ...action.payload },
        isDirty: true
      };

    case 'CREATE_NEW_VIDEO_FEED':
      feedTypeStorage.save('video');
      return {
        ...state,
        videoFeed: createEmptyVideoAlbum(),
        feedType: 'video',
        isDirty: true
      };

    default:
      return state;
  }
}

// Context
interface FeedContextType {
  state: FeedState;
  dispatch: React.Dispatch<FeedAction>;
}

const FeedContext = createContext<FeedContextType | undefined>(undefined);

// Provider
export function FeedProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(feedReducer, initialState);

  // Auto-save to localStorage whenever album changes
  useEffect(() => {
    albumStorage.save(state.album);
  }, [state.album]);

  // Auto-save video feed to localStorage
  useEffect(() => {
    if (state.videoFeed) {
      videoStorage.save(state.videoFeed);
    }
  }, [state.videoFeed]);

  // Auto-save publisher feed to localStorage
  useEffect(() => {
    if (state.publisherFeed) {
      publisherStorage.save(state.publisherFeed);
    }
  }, [state.publisherFeed]);

  return (
    <FeedContext.Provider value={{ state, dispatch }}>
      {children}
    </FeedContext.Provider>
  );
}

// Hook
export function useFeed() {
  const context = useContext(FeedContext);
  if (context === undefined) {
    throw new Error('useFeed must be used within a FeedProvider');
  }
  return context;
}
