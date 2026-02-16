/**
 * Desktop Storage - Persistent filesystem storage for Tauri desktop app
 *
 * Provides durable key-value storage backed by the app data directory.
 * Data persists even if browser localStorage is cleared.
 *
 * Storage location (appstate/):
 * - Windows: C:\Users\<user>\AppData\Roaming\com.podtards.msp-studio\data\appstate\
 * - macOS: ~/Library/Application Support/com.podtards.msp-studio/appstate/
 * - Linux: ~/.local/share/msp-studio/appstate/
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './api';

/**
 * Save data to the desktop filesystem
 * Silently no-ops in web mode
 */
export async function saveToDesktop(key: string, data: unknown): Promise<void> {
  if (!isTauri()) return;

  try {
    const json = JSON.stringify(data);
    await invoke('save_app_data', { key, value: json });
  } catch (e) {
    console.error(`[desktopStorage] Failed to save "${key}":`, e);
  }
}

/**
 * Load data from the desktop filesystem
 * Returns null in web mode or if key doesn't exist
 */
export async function loadFromDesktop<T>(key: string): Promise<T | null> {
  if (!isTauri()) return null;

  try {
    const result = await invoke<string | null>('load_app_data', { key });
    if (result) {
      return JSON.parse(result) as T;
    }
  } catch (e) {
    console.error(`[desktopStorage] Failed to load "${key}":`, e);
  }
  return null;
}

/**
 * Delete data from the desktop filesystem
 * Silently no-ops in web mode
 */
export async function deleteFromDesktop(key: string): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('delete_app_data', { key });
  } catch (e) {
    console.error(`[desktopStorage] Failed to delete "${key}":`, e);
  }
}

// Storage keys for desktop persistence
export const DESKTOP_KEYS = {
  ALBUM_DATA: 'feed-album',
  VIDEO_DATA: 'feed-video',
  PUBLISHER_DATA: 'feed-publisher',
  FEED_TYPE: 'feed-type',
  NOSTR_USER: 'nostr-user',
  HOSTED_CREDENTIALS: 'hosted-credentials',
} as const;
