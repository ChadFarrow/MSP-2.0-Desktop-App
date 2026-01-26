/**
 * Blossom Server Integration for Tauri Desktop
 * 
 * Blossom is a protocol for hosting files on servers using Nostr for auth.
 * Files are addressed by their SHA256 hash.
 * 
 * Popular Blossom servers:
 * - https://blossom.primal.net
 * - https://nostr.download
 * - https://files.sovbit.host
 * - https://blossom.band
 */

import { invoke } from '@tauri-apps/api/core';

export interface BlossomUploadResult {
  url: string;
  sha256: string;
  size: number;
}

export interface BlossomBlob {
  sha256: string;
  size: number;
  type?: string;
  uploaded?: number;
  url?: string;
}

// Default Blossom servers
export const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://nostr.download',
  'https://files.sovbit.host',
  'https://blossom.band',
];

/**
 * Upload content (like XML feeds) to a Blossom server.
 * Requires Nostr login for authentication.
 * 
 * @param serverUrl - Blossom server URL (e.g., 'https://blossom.primal.net')
 * @param content - String content to upload
 * @param contentType - MIME type (defaults to 'application/xml')
 */
export async function blossomUpload(
  serverUrl: string,
  content: string,
  contentType?: string
): Promise<BlossomUploadResult> {
  return await invoke<BlossomUploadResult>('blossom_upload', {
    serverUrl,
    content,
    contentType: contentType || null,
  });
}

/**
 * Upload a file from disk to a Blossom server.
 * Useful for uploading audio files, images, etc.
 * 
 * @param serverUrl - Blossom server URL
 * @param filePath - Path to the file on disk
 */
export async function blossomUploadFile(
  serverUrl: string,
  filePath: string
): Promise<BlossomUploadResult> {
  return await invoke<BlossomUploadResult>('blossom_upload_file', {
    serverUrl,
    filePath,
  });
}

/**
 * Delete a blob from a Blossom server.
 * Only works if you're the original uploader.
 * 
 * @param serverUrl - Blossom server URL
 * @param sha256 - Hash of the blob to delete
 */
export async function blossomDelete(
  serverUrl: string,
  sha256: string
): Promise<void> {
  return await invoke('blossom_delete', { serverUrl, sha256 });
}

/**
 * List all blobs uploaded by the logged-in user on a Blossom server.
 * 
 * @param serverUrl - Blossom server URL
 */
export async function blossomList(serverUrl: string): Promise<BlossomBlob[]> {
  return await invoke<BlossomBlob[]>('blossom_list', { serverUrl });
}

/**
 * Get the direct URL for a blob on a Blossom server.
 * This doesn't require authentication - blobs are publicly accessible.
 */
export function getBlossomUrl(serverUrl: string, sha256: string): string {
  return `${serverUrl.replace(/\/$/, '')}/${sha256}`;
}

/**
 * Check if a Blossom server is reachable
 */
export async function checkBlossomServer(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(serverUrl, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Helper to upload a feed XML and get back the URL
 */
export async function uploadFeedToBlossom(
  serverUrl: string,
  feedXml: string
): Promise<{ url: string; sha256: string }> {
  const result = await blossomUpload(serverUrl, feedXml, 'application/xml');
  return {
    url: result.url,
    sha256: result.sha256,
  };
}

/**
 * Helper to upload multiple files (like album artwork + audio)
 */
export async function uploadFilesToBlossom(
  serverUrl: string,
  filePaths: string[]
): Promise<BlossomUploadResult[]> {
  const results: BlossomUploadResult[] = [];
  
  for (const filePath of filePaths) {
    const result = await blossomUploadFile(serverUrl, filePath);
    results.push(result);
  }
  
  return results;
}
