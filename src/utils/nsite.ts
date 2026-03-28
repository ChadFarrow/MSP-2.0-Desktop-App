// nsite (NIP-5A) publishing utilities
// Publishes RSS feeds to Blossom servers and creates NIP-5A site manifests
// so feeds are accessible via nsite gateways (e.g., nsite.lol)

import type { Album, PublisherFeed } from '../types/feed';
import type { NostrEvent } from '../types/nostr';
import { generateRssFeed, generatePublisherRssFeed } from './xmlGenerator';
import { DEFAULT_RELAYS, publishEventToRelays } from './nostrRelay';
import { getSigner, hasSigner } from './nostrSigner';

// NIP-5A event kinds
const NSITE_NAMED_KIND = 35128;

// Blossom auth event kind
const BLOSSOM_AUTH_KIND = 24242;

const CLIENT_TAG = 'MSP 2.0';

const DEFAULT_GATEWAY = 'nsite.lol';

/**
 * Calculate SHA256 hash of content
 */
async function sha256Hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex pubkey to base36 (50 chars, zero-padded)
 * Used for nsite named site URL construction
 */
function hexToBase36(hex: string): string {
  const num = BigInt('0x' + hex);
  return num.toString(36).padStart(50, '0');
}

/**
 * Build the nsite URL for a named site
 * Format: https://<50-char-base36-pubkey><identifier>.gateway/path
 */
function buildNsiteUrl(pubkey: string, siteId: string, path: string, gateway = DEFAULT_GATEWAY): string {
  const base36Key = hexToBase36(pubkey);
  return `https://${base36Key}${siteId}.${gateway}${path}`;
}

/**
 * Validate a site identifier for NIP-5A named sites
 * Must be 1-13 chars, lowercase alphanumeric and hyphens
 */
function isValidSiteId(siteId: string): boolean {
  return /^[a-z0-9-]{1,13}$/.test(siteId);
}

/**
 * Generate a default site identifier from a podcast GUID
 * Takes first 8 hex chars (before first hyphen)
 */
export function defaultSiteId(podcastGuid: string): string {
  return podcastGuid.split('-')[0].toLowerCase().slice(0, 8);
}

/**
 * Create Blossom auth event (kind 24242)
 */
async function createBlossomAuthEvent(
  hash: string,
  pubkey: string
): Promise<NostrEvent> {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  return {
    kind: BLOSSOM_AUTH_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(expiration)]
    ],
    content: `upload ${hash}`
  };
}

/**
 * Create NIP-5A named site manifest event (kind 35128)
 */
function createNsiteManifest(
  pubkey: string,
  siteId: string,
  paths: Array<{ path: string; hash: string }>,
  blossomServer: string,
  title: string
): NostrEvent {
  const tags: string[][] = [
    ['d', siteId],
    ['title', title],
    ['client', CLIENT_TAG],
    ['server', blossomServer.replace(/\/$/, '')],
  ];

  for (const { path, hash } of paths) {
    tags.push(['path', path, hash]);
  }

  return {
    kind: NSITE_NAMED_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };
}

export interface NsitePublishResult {
  success: boolean;
  message: string;
  nsiteUrl?: string;
  blossomUrl?: string;
  siteId?: string;
}

type NsiteProgress = (status: string) => void;

/**
 * Publish a feed to nsite via Blossom + NIP-5A manifest
 *
 * Steps:
 * 1. Generate RSS XML
 * 2. Upload XML to Blossom server
 * 3. Publish NIP-5A site manifest to Nostr relays
 * 4. Return nsite gateway URL
 */
export async function publishToNsite(
  feed: Album | PublisherFeed,
  feedType: 'album' | 'publisher' | 'video',
  blossomServer: string,
  siteId: string,
  onProgress?: NsiteProgress
): Promise<NsitePublishResult> {
  if (!hasSigner()) {
    return { success: false, message: 'Not logged in with Nostr' };
  }

  if (!isValidSiteId(siteId)) {
    return { success: false, message: 'Site ID must be 1-13 lowercase alphanumeric characters or hyphens' };
  }

  try {
    const signer = getSigner();
    const pubkey = await signer.getPublicKey();

    // 1. Generate RSS XML
    onProgress?.('Generating RSS feed...');
    const now = new Date().toUTCString();
    let rssXml: string;
    let title: string;

    if (feedType === 'publisher') {
      const publisherFeed = feed as PublisherFeed;
      rssXml = generatePublisherRssFeed({ ...publisherFeed, lastBuildDate: now });
      title = publisherFeed.title;
    } else {
      const album = feed as Album;
      rssXml = generateRssFeed({ ...album, lastBuildDate: now });
      title = album.title;
    }

    // 2. Compute SHA256 and upload to Blossom
    onProgress?.('Uploading to Blossom server...');
    const hash = await sha256Hash(rssXml);

    const authEvent = await createBlossomAuthEvent(hash, pubkey);
    const signedAuth = await signer.signEvent(authEvent);
    const authHeader = 'Nostr ' + btoa(JSON.stringify(signedAuth));

    const serverUrl = blossomServer.replace(/\/$/, '');
    const response = await fetch(`${serverUrl}/upload`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/xml'
      },
      body: rssXml
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, message: `Blossom upload failed: ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    const blossomUrl = result.url || `${serverUrl}/${hash}.xml`;

    // 3. Create and publish NIP-5A manifest
    onProgress?.('Publishing nsite manifest to relays...');
    const manifest = createNsiteManifest(
      pubkey,
      siteId,
      [{ path: '/feed.xml', hash }],
      blossomServer,
      title
    );

    const signedManifest = await signer.signEvent(manifest);
    const { successCount } = await publishEventToRelays(signedManifest as NostrEvent, DEFAULT_RELAYS);

    if (successCount === 0) {
      return {
        success: false,
        message: 'Blossom upload succeeded but manifest failed to publish to any relay',
        blossomUrl
      };
    }

    // 4. Build nsite URL
    const nsiteUrl = buildNsiteUrl(pubkey, siteId, '/feed.xml');

    onProgress?.('Published!');
    return {
      success: true,
      message: `Feed published to nsite! Manifest sent to ${successCount} relay${successCount !== 1 ? 's' : ''}.`,
      nsiteUrl,
      blossomUrl,
      siteId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, message };
  }
}
