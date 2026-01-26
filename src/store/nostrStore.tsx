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
  | { type: 'UPDATE_PROFILE'; payload: { displayName?: string; picture?: string; nip05?: string } }
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
        nip05: action.payload.nip05 || state.user.nip05
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

  // Check for extension and restore session on mount
  useEffect(() => {
    async function init() {
      // Check for stored session
      const storedUser = loadStoredUser();
      const storedMethod = loadConnectionMethod();
      console.log('[Nostr] Init - storedUser:', storedUser?.npub, 'storedMethod:', storedMethod);

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
          console.log('[Nostr] Attempting NIP-46 reconnect, bunkerPointer:', !!bunkerPointer);
          if (bunkerPointer) {
            try {
              console.log('[Nostr] Calling reconnectNip46...');
              const pubkey = await reconnectNip46();
              console.log('[Nostr] reconnectNip46 returned:', pubkey);
              if (pubkey && pubkey === storedUser.pubkey) {
                dispatch({ type: 'RESTORE_SESSION', payload: { user: storedUser, method: 'nip46' } });

                // Refresh profile in background
                fetchNostrProfile(pubkey).then((profile) => {
                  if (profile) {
                    dispatch({
                      type: 'UPDATE_PROFILE',
                      payload: {
                        displayName: profile.display_name || profile.name,
                        picture: profile.picture,
                        nip05: profile.nip05
                      }
                    });
                  }
                });
                return;
              }
            } catch (e) {
              console.error('[Nostr] Failed to reconnect NIP-46:', e);
            }
          }
          // Failed to reconnect, clear stored session
          console.log('[Nostr] Reconnection failed, clearing stored session');
          clearStoredUser();
          clearSigner();
          dispatch({ type: 'SET_LOADING', payload: false });
        } else if (storedMethod === 'nip07' && extensionAvailable) {
          // Verify NIP-07 session
          try {
            const pubkey = await initNip07Signer();
            if (pubkey === storedUser.pubkey) {
              dispatch({ type: 'RESTORE_SESSION', payload: { user: storedUser, method: 'nip07' } });

              // Refresh profile in background
              fetchNostrProfile(pubkey).then((profile) => {
                if (profile) {
                  dispatch({
                    type: 'UPDATE_PROFILE',
                    payload: {
                      displayName: profile.display_name || profile.name,
                      picture: profile.picture,
                      nip05: profile.nip05
                    }
                  });
                }
              });
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
  }, []);

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

      // Fetch profile in background
      fetchNostrProfile(pubkey).then((profile) => {
        if (profile) {
          dispatch({
            type: 'UPDATE_PROFILE',
            payload: {
              displayName: profile.display_name || profile.name,
              picture: profile.picture,
              nip05: profile.nip05
            }
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      dispatch({ type: 'SET_ERROR', payload: message });
    }
  }, []);

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

      // Fetch profile in background
      fetchNostrProfile(pubkey).then((profile) => {
        if (profile) {
          dispatch({
            type: 'UPDATE_PROFILE',
            payload: {
              displayName: profile.display_name || profile.name,
              picture: profile.picture,
              nip05: profile.nip05
            }
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      dispatch({ type: 'SET_ERROR', payload: message });
    }
  }, []);

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
