// MSP 2.0 - Nostr Authentication State Management
import { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { NostrAuthState, NostrUser } from '../types/nostr';
import {
  hexToNpub,
  loadStoredUser,
  saveUser,
  clearStoredUser
} from '../utils/nostr';
import {
  hasNip07Extension,
  initNip07Signer,
  initNip46SignerFromBunker,
  waitForNip46Connection,
  reconnectNip46,
  clearSigner,
  loadConnectionMethod,
  loadBunkerPointer,
} from '../utils/nostrSigner';
import { fetchNostrProfile } from '../utils/nostrSync';

// Action types
type NostrAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_HAS_EXTENSION'; payload: boolean }
  | { type: 'SET_CONNECTION_METHOD'; payload: 'nip07' | 'nip46' | null }
  | { type: 'LOGIN_SUCCESS'; payload: { user: NostrUser; method: 'nip07' | 'nip46' } }
  | { type: 'UPDATE_PROFILE'; payload: { displayName?: string; picture?: string; nip05?: string; lud16?: string } }
  | { type: 'LOGOUT' }
  | { type: 'RESTORE_SESSION'; payload: { user: NostrUser; method: 'nip07' | 'nip46' } };

// Initial state
const initialState: NostrAuthState = {
  isLoggedIn: false,
  user: null,
  isLoading: true,
  error: null,
  hasExtension: false,
  connectionMethod: null,
};

// Reducer
function nostrReducer(state: NostrAuthState, action: NostrAction): NostrAuthState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'SET_HAS_EXTENSION':
      return { ...state, hasExtension: action.payload };
    case 'SET_CONNECTION_METHOD':
      return { ...state, connectionMethod: action.payload };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isLoggedIn: true,
        user: action.payload.user,
        connectionMethod: action.payload.method,
        isLoading: false,
        error: null
      };
    case 'UPDATE_PROFILE':
      if (!state.user) return state;
      const updatedUser = {
        ...state.user,
        displayName: action.payload.displayName || state.user.displayName,
        picture: action.payload.picture || state.user.picture,
        nip05: action.payload.nip05 || state.user.nip05,
        lud16: action.payload.lud16 || state.user.lud16
      };
      saveUser(updatedUser);
      return { ...state, user: updatedUser };
    case 'LOGOUT':
      return {
        ...state,
        isLoggedIn: false,
        user: null,
        error: null,
        connectionMethod: null,
      };
    case 'RESTORE_SESSION':
      return {
        ...state,
        isLoggedIn: true,
        user: action.payload.user,
        connectionMethod: action.payload.method,
        isLoading: false
      };
    default:
      return state;
  }
}

// Context
interface NostrContextType {
  state: NostrAuthState;
  login: () => Promise<void>;
  loginWithNip46: (bunkerUri?: string, onUriGenerated?: (uri: string) => void) => Promise<void>;
  logout: () => void;
}

const NostrContext = createContext<NostrContextType | undefined>(undefined);

// Provider
export function NostrProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(nostrReducer, initialState);

  // Fetch Nostr profile and dispatch UPDATE_PROFILE
  const refreshProfile = useCallback((pubkey: string) => {
    fetchNostrProfile(pubkey).then((profile) => {
      if (profile) {
        dispatch({
          type: 'UPDATE_PROFILE',
          payload: {
            displayName: profile.display_name || profile.name,
            picture: profile.picture,
            nip05: profile.nip05,
            lud16: profile.lud16
          }
        });
      }
    });
  }, []);

  // Check for extension and restore session on mount
  useEffect(() => {
    async function init() {
      // Check for stored session
      const storedUser = loadStoredUser();
      const storedMethod = loadConnectionMethod();

      // Check for NIP-07 extension
      // Wait a bit for extension to inject
      await new Promise(resolve => setTimeout(resolve, 500));
      const extensionAvailable = hasNip07Extension();
      dispatch({ type: 'SET_HAS_EXTENSION', payload: extensionAvailable });

      // Try to restore session based on stored method
      if (storedUser && storedMethod) {
        if (storedMethod === 'nip46') {
          // Try to reconnect NIP-46
          const bunkerPointer = loadBunkerPointer();
          if (bunkerPointer) {
            try {
              const pubkey = await reconnectNip46();
              if (pubkey && pubkey === storedUser.pubkey) {
                dispatch({ type: 'RESTORE_SESSION', payload: { user: storedUser, method: 'nip46' } });
                refreshProfile(pubkey);
                return;
              }
            } catch (e) {
              console.error('[Nostr] Failed to reconnect NIP-46:', e);
            }
            // Reconnect failed — if credentials are still stored it was a timeout
            // (reconnectNip46 only clears credentials for auth errors, not timeouts).
            // Restore the UI session so the user appears logged in; read-only operations
            // use the stored pubkey directly, and the signer will re-connect on the next
            // signing operation via checkSignerConnection().
            if (loadBunkerPointer()) {
              dispatch({ type: 'RESTORE_SESSION', payload: { user: storedUser, method: 'nip46' } });
              return;
            }
          }
          // Credentials were cleared (auth error) — fully log out
          clearStoredUser();
          clearSigner();
          dispatch({ type: 'SET_LOADING', payload: false });
        } else if (storedMethod === 'nip07' && extensionAvailable) {
          // Verify NIP-07 session
          try {
            const pubkey = await initNip07Signer();
            if (pubkey === storedUser.pubkey) {
              dispatch({ type: 'RESTORE_SESSION', payload: { user: storedUser, method: 'nip07' } });

              // Refresh profile in background (single source of the profile→user mapping)
              refreshProfile(pubkey);
              return;
            } else {
              // Different account, clear stored session
              clearStoredUser();
              clearSigner();
            }
          } catch {
            // Extension refused or error, clear stored session
            clearStoredUser();
            clearSigner();
          }
          dispatch({ type: 'SET_LOADING', payload: false });
        } else {
          // No valid method to restore
          clearStoredUser();
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }
    init();
  }, [refreshProfile]);

  // Login with NIP-07 (browser extension)
  const login = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const pubkey = await initNip07Signer();
      const npub = hexToNpub(pubkey);

      const user: NostrUser = {
        pubkey,
        npub,
        displayName: undefined,
        picture: undefined,
        nip05: undefined
      };

      // Save to localStorage
      saveUser(user);

      dispatch({ type: 'LOGIN_SUCCESS', payload: { user, method: 'nip07' } });

      refreshProfile(pubkey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      dispatch({ type: 'SET_ERROR', payload: message });
    }
  }, [refreshProfile]);

  // Login with NIP-46 (remote signer)
  const loginWithNip46 = useCallback(async (
    bunkerUri?: string,
    onUriGenerated?: (uri: string) => void
  ) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      let pubkey: string;

      if (bunkerUri) {
        // Bunker-initiated flow - user provided bunker:// URI
        pubkey = await initNip46SignerFromBunker(bunkerUri);
      } else if (onUriGenerated) {
        // Client-initiated flow - generate URI and wait for connection
        pubkey = await waitForNip46Connection((uri) => {
          onUriGenerated(uri);
        });
      } else {
        throw new Error('Either bunkerUri or onUriGenerated callback is required');
      }

      const npub = hexToNpub(pubkey);

      const user: NostrUser = {
        pubkey,
        npub,
        displayName: undefined,
        picture: undefined,
        nip05: undefined
      };

      // Save to localStorage
      saveUser(user);

      dispatch({ type: 'LOGIN_SUCCESS', payload: { user, method: 'nip46' } });

      refreshProfile(pubkey);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      dispatch({ type: 'SET_ERROR', payload: message });
    }
  }, [refreshProfile]);

  // Logout function
  const logout = useCallback(() => {
    clearStoredUser();
    clearSigner();
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <NostrContext.Provider value={{ state, login, loginWithNip46, logout }}>
      {children}
    </NostrContext.Provider>
  );
}

// Hook
export function useNostr() {
  const context = useContext(NostrContext);
  if (context === undefined) {
    throw new Error('useNostr must be used within a NostrProvider');
  }
  return context;
}
