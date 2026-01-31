/**
 * Auto-update utility for Tauri desktop app
 */

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/**
 * Check if an update is available
 * Returns update info if available, null otherwise
 * If throwOnError is true, throws instead of returning null on error
 */
export async function checkForUpdate(throwOnError = false): Promise<UpdateInfo | null> {
  try {
    const update = await check();

    if (!update) {
      return null;
    }

    return {
      version: update.version,
      currentVersion: update.currentVersion,
      body: update.body ?? null,
      date: update.date ?? null,
    };
  } catch (error) {
    console.error('Failed to check for updates:', error);
    if (throwOnError) {
      throw error;
    }
    return null;
  }
}

/**
 * Download and install the update, then relaunch the app
 * @param onProgress - Callback for download progress updates
 */
export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  const update = await check();

  if (!update) {
    throw new Error('No update available');
  }

  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? null;
        if (onProgress) {
          onProgress({ downloaded: 0, total });
        }
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        if (onProgress) {
          onProgress({ downloaded, total });
        }
        break;
      case 'Finished':
        if (onProgress) {
          onProgress({ downloaded: total ?? downloaded, total });
        }
        break;
    }
  });

  // Relaunch the app to apply the update
  await relaunch();
}

/**
 * Check if we're running in Tauri (desktop) environment
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Get the current app version (desktop only)
 */
export async function getAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await getVersion();
  } catch {
    return null;
  }
}
