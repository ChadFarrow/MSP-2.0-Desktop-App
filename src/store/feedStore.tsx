// MSP 2.0 - Feed State Management (React Context)
import { createContext, useContext, useReducer, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Album, Track, Person, PersonRole, ValueRecipient, Funding } from '../types/feed';
import { createEmptyAlbum, createEmptyTrack, createEmptyPerson, createEmptyPersonRole, createEmptyRecipient, createEmptyFunding } from '../types/feed';
import { albumStorage } from '../utils/storage';

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
  | { type: 'RESET' };

// State interface
interface FeedState {
  album: Album;
  isDirty: boolean;
}


// Initial state - try to load from localStorage first
const initialState: FeedState = {
  album: albumStorage.load() || createEmptyAlbum(),
  isDirty: false
};

// Reducer
function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'SET_ALBUM':
      return { album: action.payload, isDirty: false };

    case 'UPDATE_ALBUM':
      return {
        album: { ...state.album, ...action.payload },
        isDirty: true
      };

    case 'ADD_PERSON':
      return {
        album: {
          ...state.album,
          persons: [...state.album.persons, action.payload || createEmptyPerson()]
        },
        isDirty: true
      };

    case 'UPDATE_PERSON':
      return {
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
      return { album: { ...state.album, persons }, isDirty: true };
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
      return { album: { ...state.album, persons }, isDirty: true };
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
      return { album: { ...state.album, persons }, isDirty: true };
    }

    case 'ADD_RECIPIENT':
      return {
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
        album: {
          ...state.album,
          funding: [...(state.album.funding || []), action.payload || createEmptyFunding()]
        },
        isDirty: true
      };

    case 'UPDATE_FUNDING':
      return {
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
        album: {
          ...state.album,
          funding: (state.album.funding || []).filter((_, i) => i !== action.payload)
        },
        isDirty: true
      };

    case 'ADD_TRACK': {
      const newTrack = action.payload || createEmptyTrack(state.album.tracks.length + 1);
      return {
        album: {
          ...state.album,
          tracks: [...state.album.tracks, newTrack]
        },
        isDirty: true
      };
    }

    case 'UPDATE_TRACK':
      return {
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
      return { album: { ...state.album, tracks }, isDirty: true };
    }

    case 'UPDATE_TRACK_PERSON': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        track.persons = track.persons.map((p, i) =>
          i === action.payload.personIndex ? action.payload.person : p
        );
      }
      return { album: { ...state.album, tracks }, isDirty: true };
    }

    case 'REMOVE_TRACK_PERSON': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track) {
        track.persons = track.persons.filter((_, i) => i !== action.payload.personIndex);
      }
      return { album: { ...state.album, tracks }, isDirty: true };
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
      return { album: { ...state.album, tracks }, isDirty: true };
    }

    case 'UPDATE_TRACK_RECIPIENT': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        track.value.recipients = track.value.recipients.map((r, i) =>
          i === action.payload.recipientIndex ? action.payload.recipient : r
        );
      }
      return { album: { ...state.album, tracks }, isDirty: true };
    }

    case 'REMOVE_TRACK_RECIPIENT': {
      const tracks = [...state.album.tracks];
      const track = tracks[action.payload.trackIndex];
      if (track && track.value) {
        track.value.recipients = track.value.recipients.filter((_, i) => i !== action.payload.recipientIndex);
      }
      return { album: { ...state.album, tracks }, isDirty: true };
    }

    case 'RESET':
      return initialState;

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
