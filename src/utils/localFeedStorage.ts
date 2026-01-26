/**
 * Local Feed Storage for Tauri Desktop
 * 
 * Stores feeds in the app's data directory:
 * - Windows: C:\Users\<user>\AppData\Roaming\com.podtards.msp-studio\data\feeds
 * - macOS: ~/Library/Application Support/com.podtards.msp-studio/feeds
 * - Linux: ~/.local/share/msp-studio/feeds
 */

import { invoke } from '@tauri-apps/api/core';

export interface LocalFeed {
  id: string;
  title: string;
  feed_type: 'album' | 'publisher';
  xml: string;
  created_at: number;
  updated_at: number;
}

export interface FeedSummary {
  id: string;
  title: string;
  feed_type: 'album' | 'publisher';
  created_at: number;
  updated_at: number;
}

/**
 * Save a feed locally. 
 * If id is provided, updates existing feed. Otherwise creates new one.
 */
export async function saveFeedLocal(
  title: string,
  feedType: 'album' | 'publisher',
  xml: string,
  id?: string
): Promise<LocalFeed> {
  return await invoke<LocalFeed>('save_feed_local', {
    id: id || null,
    title,
    feedType,
    xml,
  });
}

/**
 * Load a feed by ID
 */
export async function loadFeedLocal(id: string): Promise<LocalFeed> {
  return await invoke<LocalFeed>('load_feed_local', { id });
}

/**
 * List all locally stored feeds (returns summaries, not full XML)
 */
export async function listFeedsLocal(): Promise<FeedSummary[]> {
  return await invoke<FeedSummary[]>('list_feeds_local');
}

/**
 * Delete a feed by ID
 */
export async function deleteFeedLocal(id: string): Promise<void> {
  return await invoke('delete_feed_local', { id });
}

/**
 * Get the path to the feeds directory
 */
export async function getFeedsDirectory(): Promise<string> {
  return await invoke<string>('get_feeds_directory');
}

/**
 * Check if running in Tauri (has local storage available)
 */
export function hasLocalStorage(): boolean {
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

/**
 * Helper to format timestamps for display
 */
export function formatFeedDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
