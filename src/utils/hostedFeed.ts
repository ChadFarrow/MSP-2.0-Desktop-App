// Hosted feed API utilities
import { hostedFeedStorage, type HostedFeedInfo } from './storage';
import { createAdminAuthHeader } from './adminAuth';
import { hasSigner } from './nostrSigner';

// Re-export type for backward compatibility
export type { HostedFeedInfo };

/**
 * Get stored hosted feed info from localStorage
 */
export function getHostedFeedInfo(podcastGuid: string): HostedFeedInfo | null {
  return hostedFeedStorage.load(podcastGuid);
}

/**
 * Save hosted feed info to localStorage
 */
export function saveHostedFeedInfo(podcastGuid: string, info: HostedFeedInfo): void {
  hostedFeedStorage.save(podcastGuid, info);
}

/**
 * Clear hosted feed info from localStorage
 */
export function clearHostedFeedInfo(podcastGuid: string): void {
  hostedFeedStorage.clear(podcastGuid);
}

interface CreateFeedResponse {
  feedId: string;
  editToken: string;
  url: string;
  blobUrl: string;
}

/**
 * Generate a random edit token (32 bytes, base64url encoded)
 */
export function generateEditToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Create a new hosted feed
 */
export async function createHostedFeed(
  xml: string,
  title: string,
  podcastGuid: string,
  editToken?: string
): Promise<CreateFeedResponse> {
  const response = await fetch('/api/hosted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xml, title, podcastGuid, editToken })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create feed' }));
    throw new Error(error.error || 'Failed to create feed');
  }

  return response.json();
}

/**
 * Update an existing hosted feed
 */
export async function updateHostedFeed(
  feedId: string,
  editToken: string,
  xml: string,
  title: string
): Promise<void> {
  const response = await fetch(`/api/hosted/${feedId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Edit-Token': editToken
    },
    body: JSON.stringify({ xml, title })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update feed' }));
    throw new Error(error.error || 'Failed to update feed');
  }
}

/**
 * Delete a hosted feed
 */
export async function deleteHostedFeed(
  feedId: string,
  editToken: string
): Promise<void> {
  const response = await fetch(`/api/hosted/${feedId}`, {
    method: 'DELETE',
    headers: { 'X-Edit-Token': editToken }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to delete feed' }));
    throw new Error(error.error || 'Failed to delete feed');
  }
}

/**
 * Build the stable URL for a hosted feed
 * Uses VITE_CANONICAL_URL env var if set, otherwise falls back to current origin
 */
export function buildHostedUrl(feedId: string): string {
  const canonicalUrl = import.meta.env.VITE_CANONICAL_URL;
  const origin = canonicalUrl
    || (window.location.hostname === 'localhost' ? 'https://msp.podtards.com' : window.location.origin);
  return `${origin}/api/hosted/${feedId}.xml`;
}

/**
 * Backup file structure for hosted feeds
 */
export interface HostedFeedBackup {
  _info: string;
  album: string;
  feedUrl: string;
  feedId: string;
  editToken: string;
  createdAt: string;
}

/**
 * Download a backup JSON file containing hosted feed credentials
 */
export function downloadHostedFeedBackup(
  feedId: string,
  editToken: string,
  albumTitle: string
): void {
  const backup: HostedFeedBackup = {
    _info: 'MSP Hosted Feed Backup - Keep this file safe!',
    album: albumTitle,
    feedUrl: buildHostedUrl(feedId),
    feedId: feedId,
    editToken: editToken,
    createdAt: new Date().toISOString()
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Generate filename: sanitize album title
  const titleSlug = albumTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'untitled';
  const feedIdPrefix = feedId.slice(0, 8);
  const filename = `msp-feed-backup-${titleSlug}-${feedIdPrefix}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================
// Nostr-authenticated API functions
// ============================================

/**
 * Create a hosted feed with Nostr authentication (for logged-in users)
 * The feed will be linked to the user's Nostr identity
 */
export async function createHostedFeedWithNostr(
  xml: string,
  title: string,
  podcastGuid: string,
  editToken?: string
): Promise<CreateFeedResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Add Nostr auth if available
  if (hasSigner()) {
    const url = `${window.location.origin}/api/hosted`;
    headers['Authorization'] = await createAdminAuthHeader(url, 'POST');
  }

  const response = await fetch('/api/hosted', {
    method: 'POST',
    headers,
    body: JSON.stringify({ xml, title, podcastGuid, editToken })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create feed' }));
    throw new Error(error.error || 'Failed to create feed');
  }

  return response.json();
}

/**
 * Update a hosted feed with Nostr authentication
 */
export async function updateHostedFeedWithNostr(
  feedId: string,
  xml: string,
  title: string
): Promise<void> {
  if (!hasSigner()) {
    throw new Error('Not logged in with Nostr');
  }

  const url = `${window.location.origin}/api/hosted/${feedId}`;
  const authHeader = await createAdminAuthHeader(url, 'PUT');

  const response = await fetch(`/api/hosted/${feedId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify({ xml, title })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to update feed' }));
    throw new Error(error.error || 'Failed to update feed');
  }
}

interface LinkNostrResponse {
  success: boolean;
  message: string;
  pubkey: string;
}

/**
 * Link a Nostr identity to an existing feed
 * Requires both the edit token (proves ownership) and Nostr auth (identity to link)
 */
export async function linkNostrToFeed(
  feedId: string,
  editToken: string
): Promise<LinkNostrResponse> {
  if (!hasSigner()) {
    throw new Error('Not logged in with Nostr');
  }

  const url = `${window.location.origin}/api/hosted/${feedId}`;
  const authHeader = await createAdminAuthHeader(url, 'PATCH');

  const response = await fetch(`/api/hosted/${feedId}`, {
    method: 'PATCH',
    headers: {
      'X-Edit-Token': editToken,
      'Authorization': authHeader
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to link Nostr identity' }));
    throw new Error(error.error || 'Failed to link Nostr identity');
  }

  return response.json();
}
