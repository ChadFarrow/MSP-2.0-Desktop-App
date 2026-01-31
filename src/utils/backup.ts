/**
 * Backup/Restore utility for MSP 2.0
 * Exports all feed data and hosted credentials to a single JSON file
 */

import type { Album, PublisherFeed } from '../types/feed';
import {
  albumStorage,
  videoStorage,
  publisherStorage,
  STORAGE_KEYS,
  type HostedFeedInfo
} from './storage';
import { isTauri } from './api';
import { getAppVersion } from './updater';

// Backup file format version
const BACKUP_VERSION = 1;
const BACKUP_TYPE = 'msp-complete-backup';

/**
 * A single feed entry in the backup
 */
export interface BackupFeedEntry<T> {
  data: T;
  hostedCredentials: HostedFeedInfo | null;
}

/**
 * Complete backup file structure
 */
export interface BackupFile {
  version: number;
  type: string;
  createdAt: string;
  appVersion: string | null;
  feeds: {
    album: BackupFeedEntry<Album> | null;
    video: BackupFeedEntry<Album> | null;
    publisher: BackupFeedEntry<PublisherFeed> | null;
  };
  metadata: {
    feedCount: number;
    hasAlbum: boolean;
    hasVideo: boolean;
    hasPublisher: boolean;
  };
}

/**
 * Result of a restore operation
 */
export interface RestoreResult {
  success: boolean;
  message: string;
  restored: {
    album: boolean;
    video: boolean;
    publisher: boolean;
  };
  credentialsRestored: number;
}

/**
 * Get hosted credentials for a specific feed GUID from localStorage
 */
function getHostedCredentials(podcastGuid: string): HostedFeedInfo | null {
  if (!podcastGuid) return null;
  try {
    const key = `${STORAGE_KEYS.HOSTED_PREFIX}${podcastGuid}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as HostedFeedInfo;
    }
  } catch (e) {
    console.error('Failed to load hosted credentials:', e);
  }
  return null;
}

/**
 * Save hosted credentials for a specific feed GUID to localStorage
 */
function saveHostedCredentials(podcastGuid: string, info: HostedFeedInfo): boolean {
  if (!podcastGuid) return false;
  try {
    const key = `${STORAGE_KEYS.HOSTED_PREFIX}${podcastGuid}`;
    localStorage.setItem(key, JSON.stringify(info));
    return true;
  } catch (e) {
    console.error('Failed to save hosted credentials:', e);
    return false;
  }
}

/**
 * Create a complete backup of all feeds and credentials
 */
export async function createCompleteBackup(): Promise<BackupFile> {
  const album = albumStorage.load();
  const video = videoStorage.load();
  const publisher = publisherStorage.load();

  const appVersion = await getAppVersion();

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    type: BACKUP_TYPE,
    createdAt: new Date().toISOString(),
    appVersion,
    feeds: {
      album: album ? {
        data: album,
        hostedCredentials: getHostedCredentials(album.podcastGuid)
      } : null,
      video: video ? {
        data: video,
        hostedCredentials: getHostedCredentials(video.podcastGuid)
      } : null,
      publisher: publisher ? {
        data: publisher,
        hostedCredentials: getHostedCredentials(publisher.podcastGuid)
      } : null
    },
    metadata: {
      feedCount: (album ? 1 : 0) + (video ? 1 : 0) + (publisher ? 1 : 0),
      hasAlbum: !!album,
      hasVideo: !!video,
      hasPublisher: !!publisher
    }
  };

  return backup;
}

/**
 * Generate a default backup filename
 */
function generateBackupFilename(): string {
  const date = new Date().toISOString().split('T')[0];
  return `msp-backup-${date}.json`;
}

/**
 * Save backup to file using Tauri dialog or web fallback
 */
export async function saveBackupToFile(backup: BackupFile): Promise<{ success: boolean; message: string }> {
  const jsonContent = JSON.stringify(backup, null, 2);
  const defaultFilename = generateBackupFilename();

  if (isTauri()) {
    try {
      // Dynamic import for Tauri plugins
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await save({
        defaultPath: defaultFilename,
        filters: [{
          name: 'JSON Backup',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return { success: false, message: 'Save cancelled' };
      }

      await writeTextFile(filePath, jsonContent);
      return { success: true, message: 'Backup saved successfully' };
    } catch (error) {
      console.error('Tauri save failed:', error);
      return { success: false, message: error instanceof Error ? error.message : 'Failed to save backup' };
    }
  } else {
    // Web fallback: blob download
    try {
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true, message: 'Backup download started' };
    } catch (error) {
      console.error('Web download failed:', error);
      return { success: false, message: error instanceof Error ? error.message : 'Failed to download backup' };
    }
  }
}

/**
 * Load backup from file using Tauri dialog or web fallback
 * Returns the parsed backup file or null if cancelled/failed
 */
export async function loadBackupFromFile(): Promise<{ backup: BackupFile | null; error?: string }> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await open({
        multiple: false,
        filters: [{
          name: 'JSON Backup',
          extensions: ['json']
        }]
      });

      if (!filePath) {
        return { backup: null };
      }

      // Handle both string path and array
      const path = Array.isArray(filePath) ? filePath[0] : filePath;
      if (!path) {
        return { backup: null };
      }

      const content = await readTextFile(path);
      const data = JSON.parse(content);

      const validationError = validateBackup(data);
      if (validationError) {
        return { backup: null, error: validationError };
      }

      return { backup: data as BackupFile };
    } catch (error) {
      console.error('Tauri load failed:', error);
      return { backup: null, error: error instanceof Error ? error.message : 'Failed to load backup' };
    }
  } else {
    // Web fallback: file input handled by component
    // This function won't be called directly in web mode
    return { backup: null, error: 'Use file input for web mode' };
  }
}

/**
 * Parse backup from file content (for web file input)
 */
export function parseBackupFromContent(content: string): { backup: BackupFile | null; error?: string } {
  try {
    const data = JSON.parse(content);
    const validationError = validateBackup(data);
    if (validationError) {
      return { backup: null, error: validationError };
    }
    return { backup: data as BackupFile };
  } catch {
    return { backup: null, error: 'Invalid JSON format' };
  }
}

/**
 * Validate backup file structure
 * Returns error message if invalid, null if valid
 */
export function validateBackup(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return 'Invalid backup file: not an object';
  }

  const backup = data as Record<string, unknown>;

  if (backup.type !== BACKUP_TYPE) {
    return 'Invalid backup file: wrong type';
  }

  if (typeof backup.version !== 'number' || backup.version < 1) {
    return 'Invalid backup file: missing or invalid version';
  }

  if (backup.version > BACKUP_VERSION) {
    return `Backup file version ${backup.version} is newer than supported version ${BACKUP_VERSION}`;
  }

  if (!backup.feeds || typeof backup.feeds !== 'object') {
    return 'Invalid backup file: missing feeds';
  }

  return null;
}

/**
 * Preview what will be restored from a backup
 */
export function getBackupPreview(backup: BackupFile): {
  album: { title: string; author: string; trackCount: number; hasCredentials: boolean } | null;
  video: { title: string; author: string; trackCount: number; hasCredentials: boolean } | null;
  publisher: { title: string; author: string; feedCount: number; hasCredentials: boolean } | null;
} {
  return {
    album: backup.feeds.album ? {
      title: backup.feeds.album.data.title || 'Untitled Album',
      author: backup.feeds.album.data.author || 'Unknown Artist',
      trackCount: backup.feeds.album.data.tracks?.length || 0,
      hasCredentials: !!backup.feeds.album.hostedCredentials
    } : null,
    video: backup.feeds.video ? {
      title: backup.feeds.video.data.title || 'Untitled Video',
      author: backup.feeds.video.data.author || 'Unknown Creator',
      trackCount: backup.feeds.video.data.tracks?.length || 0,
      hasCredentials: !!backup.feeds.video.hostedCredentials
    } : null,
    publisher: backup.feeds.publisher ? {
      title: backup.feeds.publisher.data.title || 'Untitled Publisher',
      author: backup.feeds.publisher.data.author || 'Unknown Publisher',
      feedCount: backup.feeds.publisher.data.remoteItems?.length || 0,
      hasCredentials: !!backup.feeds.publisher.hostedCredentials
    } : null
  };
}

/**
 * Restore feeds from backup
 * @param backup - The backup file to restore from
 * @param mode - 'replace' to overwrite existing data, 'merge' to only restore missing feeds
 */
export function restoreFromBackup(
  backup: BackupFile,
  mode: 'replace' | 'merge' = 'replace'
): RestoreResult {
  const result: RestoreResult = {
    success: true,
    message: '',
    restored: {
      album: false,
      video: false,
      publisher: false
    },
    credentialsRestored: 0
  };

  try {
    // Restore album
    if (backup.feeds.album) {
      const existingAlbum = albumStorage.load();
      if (mode === 'replace' || !existingAlbum) {
        albumStorage.save(backup.feeds.album.data);
        result.restored.album = true;

        if (backup.feeds.album.hostedCredentials && backup.feeds.album.data.podcastGuid) {
          saveHostedCredentials(backup.feeds.album.data.podcastGuid, backup.feeds.album.hostedCredentials);
          result.credentialsRestored++;
        }
      }
    }

    // Restore video
    if (backup.feeds.video) {
      const existingVideo = videoStorage.load();
      if (mode === 'replace' || !existingVideo) {
        videoStorage.save(backup.feeds.video.data);
        result.restored.video = true;

        if (backup.feeds.video.hostedCredentials && backup.feeds.video.data.podcastGuid) {
          saveHostedCredentials(backup.feeds.video.data.podcastGuid, backup.feeds.video.hostedCredentials);
          result.credentialsRestored++;
        }
      }
    }

    // Restore publisher
    if (backup.feeds.publisher) {
      const existingPublisher = publisherStorage.load();
      if (mode === 'replace' || !existingPublisher) {
        publisherStorage.save(backup.feeds.publisher.data);
        result.restored.publisher = true;

        if (backup.feeds.publisher.hostedCredentials && backup.feeds.publisher.data.podcastGuid) {
          saveHostedCredentials(backup.feeds.publisher.data.podcastGuid, backup.feeds.publisher.hostedCredentials);
          result.credentialsRestored++;
        }
      }
    }

    // Build success message
    const restoredFeeds: string[] = [];
    if (result.restored.album) restoredFeeds.push('album');
    if (result.restored.video) restoredFeeds.push('video');
    if (result.restored.publisher) restoredFeeds.push('publisher');

    if (restoredFeeds.length === 0) {
      result.message = mode === 'merge'
        ? 'No feeds restored (all feeds already exist)'
        : 'No feeds to restore';
    } else {
      result.message = `Restored ${restoredFeeds.join(', ')} feed${restoredFeeds.length > 1 ? 's' : ''}`;
      if (result.credentialsRestored > 0) {
        result.message += ` with ${result.credentialsRestored} hosted credential${result.credentialsRestored > 1 ? 's' : ''}`;
      }
    }
  } catch (error) {
    result.success = false;
    result.message = error instanceof Error ? error.message : 'Failed to restore backup';
  }

  return result;
}
