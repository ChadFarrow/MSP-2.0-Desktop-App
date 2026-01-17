// MSP 2.0 - Feed State Management (React Context)
import { createContext, useContext, useReducer, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Album, Track, Person, PersonRole, ValueRecipient, Funding, PublisherFeed, RemoteItem } from '../types/feed';
import { createEmptyAlbum, createEmptyTrack, createEmptyPerson, createEmptyPersonRole, createEmptyRecipient, createEmptyFunding, createEmptyPublisherFeed, createEmptyRemoteItem } from '../types/feed';
import { albumStorage, publisherStorage } from '../utils/storage';

// Feed type enum
export type FeedType = 'album' | 'publisher';

// Action types
type FeedAction =
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
  | { type: 'REMOVE_PUBLISHER_RECIPIENT'; payload: number };

// State interface
interface FeedState {
  feedType: FeedType;
  album: Album;
  publisherFeed: PublisherFeed | null;
  isDirty: boolean;
}


// Initial state - try to load from localStorage first
const initialState: FeedState = {
  feedType: 'album',
  album: albumStorage.load() || createEmptyAlbum(),
  publisherFeed: publisherStorage.load() || null,
  isDirty: false
};

// Reducer
function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'SET_ALBUM':
      return { ...state, album: action.payload, feedType: 'album', isDirty: false };

    case 'UPDATE_ALBUM':
      return {
        ...state,
        album: { ...state.album, ...action.payload },
        isDirty: true
      };

    case 'ADD_PERSON':
      return {
        ...state,
        album: {
          ...state.album,
          persons: [...state.album.persons, action.payload || createEmptyPerson()]
        },
        isDirty: true
      };

    case 'UPDATE_PERSON':
      return {
        ...state,
        album: {
          ...state.album,
          persons: state.album.persons.map((p, i) =>
            i === action.payload.index ? action.payload.person : p
          )
        },
        isDirty: true
      };

    case 'REMOVE_PERSON':
      return {
        ...state,
        album: {
          ...state.album,
          persons: state.album.persons.filter((_, i) => i !== action.payload)
        },
        isDirty: true
      };

    case 'ADD_PERSON_ROLE': {
      const persons = [...state.album.persons];
      const person = persons[action.payload.personIndex];
      if (person) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: [...person.roles, action.payload.role || createEmptyPersonRole()]
        };
      }
      return { ...state, album: { ...state.album, persons }, isDirty: true };
    }

    case 'UPDATE_PERSON_ROLE': {
      const persons = [...state.album.persons];
      const person = persons[action.payload.personIndex];
      if (person) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: person.roles.map((r, i) =>
            i === action.payload.roleIndex ? action.payload.role : r
          )
        };
      }
      return { ...state, album: { ...state.album, persons }, isDirty: true };
    }

    case 'REMOVE_PERSON_ROLE': {
      const persons = [...state.album.persons];
      const person = persons[action.payload.personIndex];
      if (person && person.roles.length > 1) {
        persons[action.payload.personIndex] = {
          ...person,
          roles: person.roles.filter((_, i) => i !== action.payload.roleIndex)
        };
      }
      return { ...state, album: { ...state.album, persons }, isDirty: true };
    }

    case 'ADD_RECIPIENT':
      return {
        ...state,
        album: {
          ...state.album,
          value: {
            ...state.album.value,
            recipients: [...state.album.value.recipients, action.payload || createEmptyRecipient()]
          }
        },
        isDirty: true
      };

    case 'UPDATE_RECIPIENT':
      return {
        ...state,
        album: {
          ...state.album,
          value: {
            ...state.album.value,
            recipients: state.album.value.recipients.map((r, i) =>
              i === action.payload.index ? action.payload.recipient : r
            )
          }
        },
        isDirty: true
      };

    case 'REMOVE_RECIPIENT':
      return {
        ...state,
        album: {
          ...state.album,
          value: {
            ...state.album.value,
            recipients: state.album.value.recipients.filter((_, i) => i !== action.payload)
          }
        },
        isDirty: true
      };

    case 'ADD_FUNDING':
      return {
        ...state,
        album: {
          ...state.album,
          funding: [...(state.album.funding || []), action.payload || createEmptyFunding()]
        },
        isDirty: true
      };

    case 'UPDATE_FUNDING':
      return {
        ...state,
        album: {
          ...state.album,
          funding: (state.album.funding || []).map((f, i) =>
            i === action.payload.index ? action.payload.funding : f
          )
        },
        isDirty: true
      };

    case 'REMOVE_FUNDING':
      return {
        ...state,
        album: {
          ...state.album,
          funding: (state.album.funding || []).filter((_, i) => i !== action.payload)
        },
        isDirty: true
      };

    case 'ADD_TRACK': {
      const newTrack = action.payload || createEmptyTrack(state.album.tracks.length + 1);
      return {
        ...state,
        album: {
          ...state.album,
          tracks: [...state.album.tracks, newTrack]
        },
        isDirty: true
      };
    }

    case 'UPDATE_TRACK':
      return {
        ...state,
        album: {
          ...state.album,
          tracks: state.album.tracks.map((t, i) =>
            i === action.payload.index ? { ...t, ...action.payload.track } : t
          )
        },
        isDirty: true
      };

    case 'REMOVE_TRACK':
      return {
        ...state,
        album: {
          ...state.album,
          tracks: state.album.tracks
            .filter((_, i) => i !== action.payload)
            .map((t, i) => ({ ...t, trackNumber: i + 1 }))
        },
        isDirty: true
      };

    case 'REORDER_TRACKS': {
      const tracks = [...state.album.tracks];
      const [removed] = tracks.splice(action.payload.fromIndex, 1);
      tracks.splice(action.payload.toIndex, 0, removed);
      return {
        ...state,
        album: {
          ...state.album,
          tracks: tracks.map((t, i) => ({ ...t, trackNumber: i + 1 }))
        },
        isDirty: true
      };
    }

    case 'ADD_TRACK_PERSON': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        track.persons = [...track.persons, action.payload.person || createEmptyPerson()];
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'UPDATE_TRACK_PERSON': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        track.persons = track.persons.map((p, i) =>
          i === action.payload.personIndex ? action.payload.person : p
        );
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'REMOVE_TRACK_PERSON': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        track.persons = track.persons.filter((_, i) => i !== action.payload.personIndex);
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'ADD_TRACK_RECIPIENT': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        if (!track.value) {
          track.value = { type: 'lightning', method: 'keysend', recipients: [] };
        }
        track.value.recipients = [...track.value.recipients, action.payload.recipient || createEmptyRecipient()];
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'UPDATE_TRACK_RECIPIENT': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        track.value.recipients = track.value.recipients.map((r, i) =>
          i === action.payload.recipientIndex ? action.payload.recipient : r
        );
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'REMOVE_TRACK_RECIPIENT': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        track.value.recipients = track.value.recipients.filter((_, i) => i !== action.payload.recipientIndex);
      }
      return { ...state, album: { ...state.album, tracks }, isDirty: true };
    }

    case 'RESET':
      return initialState;

    // Publisher feed actions
    case 'SET_FEED_TYPE':
      return { ...state, feedType: action.payload };

    case 'SET_PUBLISHER_FEED':
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
      return {
        ...state,
        publisherFeed: createEmptyPublisherFeed(),
        feedType: 'publisher',
        isDirty: true
      };

    case 'ADD_PUBLISHER_RECIPIENT':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          value: {
            ...state.publisherFeed.value,
            recipients: [...state.publisherFeed.value.recipients, action.payload || createEmptyRecipient()]
          }
        },
        isDirty: true
      };

    case 'UPDATE_PUBLISHER_RECIPIENT':
      if (!state.publisherFeed) return state;
      return {
        ...state,
        publisherFeed: {
          ...state.publisherFeed,
          value: {
            ...state.publisherFeed.value,
            recipients: state.publisherFeed.value.recipients.map((r, i) =>
              i === action.payload.index ? action.payload.recipient : r
            )
          }
        },
        isDirty: true
      };

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
