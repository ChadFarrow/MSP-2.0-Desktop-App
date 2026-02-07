// Admin authentication utilities for frontend
import { getSigner, hasSigner } from './nostrSigner';
import { apiFetch, resolveApiUrl } from './api';

interface NostrEvent {
  id?: string;
  pubkey?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

interface FeedInfo {
  feedId: string;
  title?: string;
  createdAt?: string;
  lastUpdated?: string;
}

interface ListFeedsResponse {
  feeds: FeedInfo[];
  count: number;
}

// Sign a NIP-98 auth event
async function signAuthEvent(url: string, method: string): Promise<NostrEvent> {
  if (!hasSigner()) {
    throw new Error('Not logged in');
  }

  const signer = getSigner();
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method]
    ],
    content: ''
  };

  return await signer.signEvent(event) as NostrEvent;
}

// Full authentication flow
export async function authenticateAdmin(): Promise<{ success: boolean; pubkey?: string; error?: string }> {
  try {
    // Sign auth event (timestamp in event prevents replay)
    const signedEvent = await signAuthEvent(
      resolveApiUrl('/api/admin/verify'),
      'POST'
    );

    // Verify with server
    const response = await apiFetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedEvent })
    });

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed'
    };
  }
}

// Create Authorization header for admin API requests
export async function createAdminAuthHeader(url: string, method: string): Promise<string> {
  if (!hasSigner()) {
    throw new Error('Not logged in');
  }

  const signer = getSigner();
  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method]
    ],
    content: ''
  };

  const signedEvent = await signer.signEvent(event);
  const eventJson = JSON.stringify(signedEvent);
  const base64Event = btoa(eventJson);

  return `Nostr ${base64Event}`;
}

// Fetch list of feeds with admin auth
export async function fetchAdminFeeds(): Promise<ListFeedsResponse> {
  const url = resolveApiUrl('/api/hosted/');
  const authHeader = await createAdminAuthHeader(url, 'GET');

  const response = await apiFetch('/api/hosted/', {
    headers: { 'Authorization': authHeader }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch feeds');
  }

  return response.json();
}

// Delete a feed with admin auth
export async function deleteFeed(feedId: string): Promise<void> {
  const url = resolveApiUrl(`/api/hosted/${feedId}`);
  const authHeader = await createAdminAuthHeader(url, 'DELETE');

  const response = await apiFetch(`/api/hosted/${feedId}`, {
    method: 'DELETE',
    headers: { 'Authorization': authHeader }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete feed');
  }
}
