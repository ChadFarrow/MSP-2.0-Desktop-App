// Publisher Feed Publish Flow Utility
// Handles the one-click publish workflow for publisher feeds

import type { PublisherFeed, RemoteItem } from '../types/feed';
import { generatePublisherRssFeed } from './xmlGenerator';
import {
  getHostedFeedInfo,
  saveHostedFeedInfo,
  createHostedFeed,
  createHostedFeedWithNostr,
  updateHostedFeed,
  updateHostedFeedWithNostr,
  buildHostedUrl,
  generateEditToken,
  type HostedFeedInfo
} from './hostedFeed';
import { hasSigner } from './nostrSigner';
import { fetchFeedFromUrl, parseRssFeed } from './xmlParser';
import { generateRssFeed, downloadXml } from './xmlGenerator';

// Types for publish flow
export type PublishStep = 'idle' | 'hosting-catalog' | 'hosting' | 'notifying' | 'updating-catalog' | 'complete' | 'error';

export interface PublishProgress {
  step: PublishStep;
  message: string;
  catalogProgress?: {
    current: number;
    total: number;
    currentFeed: string;
  };
}

export interface FeedUpdateResult {
  title: string;
  feedGuid: string;
  status: 'hosted' | 'updated' | 'downloaded' | 'skipped' | 'error';
  message?: string;
  newUrl?: string;
}

export interface PublishResult {
  success: boolean;
  feedUrl?: string;
  piStatus?: 'indexed' | 'pending' | 'failed';
  piPageUrl?: string;
  catalogHostResults?: FeedUpdateResult[];
  catalogUpdateResults?: FeedUpdateResult[];
  error?: string;
  hostedInfo?: HostedFeedInfo;
  updatedPublisherFeed?: PublisherFeed;
}

export interface PublishOptions {
  hostCatalogFeeds: boolean;
  updateCatalogFeeds: boolean;
  linkNostr: boolean;
  nostrPubkey?: string;
  onProgress: (progress: PublishProgress) => void;
}

// Helper to check if a feed URL is MSP-hosted
const isMspHosted = (url: string): boolean => {
  if (!url) return false;
  return (
    url.includes('/api/hosted/') ||
    url.includes('msp.podtards.com') ||
    url.includes('msp-2-0')
  );
};

// Helper to extract feedId from MSP hosted URL
const extractFeedIdFromUrl = (url: string): string | null => {
  const match = url.match(/\/api\/hosted\/([a-zA-Z0-9-]+)(?:\.xml)?/);
  return match ? match[1] : null;
};

// Notify Podcast Index about a feed update
async function notifyPodcastIndex(feedUrl: string): Promise<{ status: 'indexed' | 'pending' | 'failed'; pageUrl?: string }> {
  try {
    const res = await fetch(`/api/pubnotify?url=${encodeURIComponent(feedUrl)}`);
    const data = await res.json();
    if (data.success) {
      if (data.podcastIndexUrl) {
        return { status: 'indexed', pageUrl: data.podcastIndexUrl };
      }
      return { status: 'pending' };
    }
    return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

// Check if a catalog feed needs to be hosted (no credentials or feed doesn't exist)
function needsHosting(item: RemoteItem): boolean {
  // If no feedGuid, can't host
  if (!item.feedGuid) return false;

  // Check if we already have credentials for this feed
  const hostedInfo = getHostedFeedInfo(item.feedGuid);
  if (hostedInfo) {
    // Already have credentials - doesn't need hosting
    return false;
  }

  // No credentials - needs hosting
  return true;
}

// Host a single catalog feed on MSP
async function hostCatalogFeed(
  item: RemoteItem,
  linkNostr: boolean,
  nostrPubkey?: string
): Promise<FeedUpdateResult> {
  const title = item.title || item.feedGuid;

  if (!item.feedGuid) {
    return {
      title,
      feedGuid: item.feedGuid || '',
      status: 'error',
      message: 'No feed GUID'
    };
  }

  // Check if we already have credentials
  const existingInfo = getHostedFeedInfo(item.feedGuid);
  if (existingInfo) {
    return {
      title,
      feedGuid: item.feedGuid,
      status: 'skipped',
      message: 'Already hosted',
      newUrl: buildHostedUrl(existingInfo.feedId)
    };
  }

  // Try to fetch the feed from its current URL
  if (!item.feedUrl) {
    return {
      title,
      feedGuid: item.feedGuid,
      status: 'error',
      message: 'No feed URL to fetch from'
    };
  }

  try {
    // Fetch and parse the feed
    const xml = await fetchFeedFromUrl(item.feedUrl);
    const album = parseRssFeed(xml);

    // Regenerate the XML (ensures it's in our format)
    const cleanXml = generateRssFeed(album);
    const feedTitle = album.title || title;

    // Host on MSP
    const editToken = generateEditToken();
    const shouldLinkNostr = linkNostr && nostrPubkey && hasSigner();

    let result;
    let hostedInfo: HostedFeedInfo;

    try {
      if (shouldLinkNostr) {
        result = await createHostedFeedWithNostr(cleanXml, feedTitle, item.feedGuid, editToken);
        hostedInfo = {
          feedId: result.feedId,
          editToken,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          ownerPubkey: nostrPubkey,
          linkedAt: Date.now()
        };
      } else {
        result = await createHostedFeed(cleanXml, feedTitle, item.feedGuid, editToken);
        hostedInfo = {
          feedId: result.feedId,
          editToken,
          createdAt: Date.now(),
          lastUpdated: Date.now()
        };
      }

      // Save credentials
      saveHostedFeedInfo(item.feedGuid, hostedInfo);

      // Notify PI in background
      notifyPodcastIndex(result.url).catch(() => {});

      return {
        title: feedTitle,
        feedGuid: item.feedGuid,
        status: 'hosted',
        message: 'Hosted on MSP',
        newUrl: result.url
      };
    } catch (hostErr) {
      // Check if feed already exists (409 Conflict)
      const errMsg = hostErr instanceof Error ? hostErr.message : '';
      if (errMsg.includes('already exists') || errMsg.includes('409')) {
        // Feed exists on MSP but we don't have credentials
        // Return the MSP URL anyway so the publisher feed can reference it
        const mspUrl = buildHostedUrl(item.feedGuid);
        return {
          title: feedTitle,
          feedGuid: item.feedGuid,
          status: 'skipped',
          message: 'Exists on MSP (no credentials)',
          newUrl: mspUrl
        };
      }
      throw hostErr;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.toLowerCase() : '';

    // Check if this is an MSP-hosted URL
    if (isMspHosted(item.feedUrl)) {
      // If it's a CORS error, network error, or 404 for an MSP URL,
      // the feed likely exists but we just can't access it from the browser
      const isCorsOrNetworkError =
        errMsg.includes('failed to fetch') ||
        errMsg.includes('networkerror') ||
        errMsg.includes('network error') ||
        errMsg.includes('cors') ||
        errMsg.includes('blocked') ||
        errMsg.includes('404') ||
        errMsg.includes('not found') ||
        errMsg.includes('paste the xml');

      if (isCorsOrNetworkError) {
        return {
          title,
          feedGuid: item.feedGuid,
          status: 'skipped',
          message: 'Exists on MSP (no credentials)',
          newUrl: buildHostedUrl(item.feedGuid)
        };
      }
    }

    return {
      title,
      feedGuid: item.feedGuid,
      status: 'error',
      message: err instanceof Error ? err.message : 'Failed to host feed'
    };
  }
}

// Process a single catalog feed to add publisher reference
async function processCatalogFeed(
  item: RemoteItem,
  publisherGuid: string,
  publisherFeedUrl: string
): Promise<FeedUpdateResult> {
  const feedUrl = item.feedUrl;
  const title = item.title || item.feedGuid;

  if (!feedUrl) {
    return {
      title,
      feedGuid: item.feedGuid,
      status: 'error',
      message: 'No feed URL available'
    };
  }

  try {
    // Fetch and parse the feed
    const xml = await fetchFeedFromUrl(feedUrl);
    const album = parseRssFeed(xml);

    // Add/update publisher reference
    album.publisher = {
      feedGuid: publisherGuid,
      feedUrl: publisherFeedUrl
    };

    // Generate updated XML
    const updatedXml = generateRssFeed(album);
    const feedTitle = album.title || title;

    // Check if MSP-hosted and has credentials
    if (isMspHosted(feedUrl)) {
      const feedId = extractFeedIdFromUrl(feedUrl);
      if (feedId) {
        const hostedInfo = getHostedFeedInfo(album.podcastGuid);
        if (hostedInfo && hostedInfo.feedId === feedId) {
          // We have credentials - update directly
          await updateHostedFeed(feedId, hostedInfo.editToken, updatedXml, feedTitle);
          // Notify PI in background (don't wait)
          notifyPodcastIndex(feedUrl).catch(() => {});
          return {
            title: feedTitle,
            feedGuid: item.feedGuid,
            status: 'updated',
            message: 'Updated on MSP'
          };
        }
      }
    }

    // No credentials or not MSP-hosted - download for manual upload
    const safeTitle = feedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'feed';
    const filename = `${safeTitle}-with-publisher.xml`;
    downloadXml(updatedXml, filename);
    return {
      title: feedTitle,
      feedGuid: item.feedGuid,
      status: 'downloaded',
      message: 'Downloaded for manual upload'
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message.toLowerCase() : '';

    // Check if this is an MSP-hosted URL with CORS/network error
    if (isMspHosted(feedUrl)) {
      const isCorsOrNetworkError =
        errMsg.includes('failed to fetch') ||
        errMsg.includes('networkerror') ||
        errMsg.includes('network error') ||
        errMsg.includes('cors') ||
        errMsg.includes('blocked') ||
        errMsg.includes('paste the xml');

      if (isCorsOrNetworkError) {
        // We have credentials, we just can't fetch due to CORS
        // Try to update directly using the feed GUID
        const hostedInfo = getHostedFeedInfo(item.feedGuid);
        if (hostedInfo) {
          // We have credentials but can't fetch the current XML
          // This is a limitation - we'd need a server-side proxy
          return {
            title,
            feedGuid: item.feedGuid,
            status: 'skipped',
            message: 'CORS blocked - update manually'
          };
        }
        return {
          title,
          feedGuid: item.feedGuid,
          status: 'skipped',
          message: 'MSP feed - no credentials'
        };
      }
    }

    return {
      title,
      feedGuid: item.feedGuid,
      status: 'error',
      message: err instanceof Error ? err.message : 'Failed to process feed'
    };
  }
}

/**
 * Main publish flow for publisher feeds
 * 1. Host unhosted catalog feeds on MSP (optional)
 * 2. Host/update publisher feed on MSP
 * 3. Notify Podcast Index
 * 4. Update catalog feeds with publisher reference (optional)
 */
export async function publishPublisherFeed(
  publisherFeed: PublisherFeed,
  options: PublishOptions
): Promise<PublishResult> {
  const { hostCatalogFeeds, updateCatalogFeeds, linkNostr, nostrPubkey, onProgress } = options;

  const podcastGuid = publisherFeed.podcastGuid;
  if (!podcastGuid) {
    return { success: false, error: 'Publisher feed must have a GUID' };
  }

  // Make a mutable copy of the publisher feed to update URLs
  const updatedPublisherFeed: PublisherFeed = {
    ...publisherFeed,
    remoteItems: [...publisherFeed.remoteItems]
  };

  // Step 1: Host unhosted catalog feeds (if requested)
  let catalogHostResults: FeedUpdateResult[] | undefined;

  if (hostCatalogFeeds && publisherFeed.remoteItems.length > 0) {
    const feedsToHost = publisherFeed.remoteItems.filter(needsHosting);

    if (feedsToHost.length > 0) {
      onProgress({
        step: 'hosting-catalog',
        message: `Hosting ${feedsToHost.length} catalog feed(s)...`,
        catalogProgress: { current: 0, total: feedsToHost.length, currentFeed: '' }
      });

      catalogHostResults = [];

      for (let i = 0; i < publisherFeed.remoteItems.length; i++) {
        const item = publisherFeed.remoteItems[i];

        if (!needsHosting(item)) {
          // Already hosted - get the URL
          const hostedInfo = getHostedFeedInfo(item.feedGuid);
          if (hostedInfo) {
            const newUrl = buildHostedUrl(hostedInfo.feedId);
            // Update the URL in our copy
            updatedPublisherFeed.remoteItems[i] = { ...item, feedUrl: newUrl };
            catalogHostResults.push({
              title: item.title || item.feedGuid,
              feedGuid: item.feedGuid,
              status: 'skipped',
              message: 'Already hosted',
              newUrl
            });
          }
          continue;
        }

        onProgress({
          step: 'hosting-catalog',
          message: `Hosting ${item.title || item.feedGuid}...`,
          catalogProgress: {
            current: catalogHostResults.filter(r => r.status !== 'skipped').length + 1,
            total: feedsToHost.length,
            currentFeed: item.title || item.feedGuid
          }
        });

        const result = await hostCatalogFeed(item, linkNostr, nostrPubkey);
        catalogHostResults.push(result);

        // Update the URL in our copy if hosting succeeded
        if (result.status === 'hosted' && result.newUrl) {
          updatedPublisherFeed.remoteItems[i] = { ...item, feedUrl: result.newUrl };
        }
      }
    }
  }

  // Check for existing hosted info for publisher feed
  const existingInfo = getHostedFeedInfo(podcastGuid);
  const isUpdate = !!existingInfo;

  // Step 2: Host/update publisher feed on MSP
  onProgress({ step: 'hosting', message: isUpdate ? 'Updating publisher feed on MSP...' : 'Creating publisher feed on MSP...' });

  let hostedInfo: HostedFeedInfo;
  let feedUrl: string;

  try {
    // Use the updated publisher feed with new catalog URLs
    const xml = generatePublisherRssFeed(updatedPublisherFeed);
    const title = updatedPublisherFeed.title || 'Publisher Feed';

    if (existingInfo) {
      // Update existing feed
      const isNostrLinked = existingInfo.ownerPubkey && nostrPubkey === existingInfo.ownerPubkey;

      if (isNostrLinked && hasSigner()) {
        await updateHostedFeedWithNostr(existingInfo.feedId, xml, title);
      } else {
        await updateHostedFeed(existingInfo.feedId, existingInfo.editToken, xml, title);
      }

      hostedInfo = { ...existingInfo, lastUpdated: Date.now() };
      saveHostedFeedInfo(podcastGuid, hostedInfo);
      feedUrl = buildHostedUrl(existingInfo.feedId);
    } else {
      // Create new feed
      const editToken = generateEditToken();
      const shouldLinkNostr = linkNostr && nostrPubkey && hasSigner();

      try {
        let result;
        if (shouldLinkNostr) {
          result = await createHostedFeedWithNostr(xml, title, podcastGuid, editToken);
          hostedInfo = {
            feedId: result.feedId,
            editToken,
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            ownerPubkey: nostrPubkey,
            linkedAt: Date.now()
          };
        } else {
          result = await createHostedFeed(xml, title, podcastGuid, editToken);
          hostedInfo = {
            feedId: result.feedId,
            editToken,
            createdAt: Date.now(),
            lastUpdated: Date.now()
          };
        }

        saveHostedFeedInfo(podcastGuid, hostedInfo);
        feedUrl = result.url;
      } catch (createErr) {
        const errMsg = createErr instanceof Error ? createErr.message : '';

        // Handle 409 Conflict - feed already exists
        if (errMsg.includes('already exists') || errMsg.includes('409')) {
          // If user is logged in with Nostr, try to update via Nostr auth
          if (nostrPubkey && hasSigner()) {
            try {
              await updateHostedFeedWithNostr(podcastGuid, xml, title);
              // Success - create local hostedInfo without edit token
              hostedInfo = {
                feedId: podcastGuid,
                editToken: '', // We don't have the token, but Nostr works
                createdAt: Date.now(),
                lastUpdated: Date.now(),
                ownerPubkey: nostrPubkey,
                linkedAt: Date.now()
              };
              saveHostedFeedInfo(podcastGuid, hostedInfo);
              feedUrl = buildHostedUrl(podcastGuid);
            } catch (nostrErr) {
              // Nostr update also failed - feed exists but user doesn't have access
              throw new Error(
                'This feed already exists on MSP. If you are the owner, use the Restore option in the Save dialog to recover your credentials, or log in with the Nostr identity linked to this feed.'
              );
            }
          } else {
            throw new Error(
              'This feed already exists on MSP. Use the Restore option in the Save dialog to recover your edit credentials.'
            );
          }
        } else {
          throw createErr;
        }
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to host feed',
      catalogHostResults
    };
  }

  // Step 3: Notify Podcast Index
  onProgress({ step: 'notifying', message: 'Notifying Podcast Index...' });
  const piResult = await notifyPodcastIndex(feedUrl);

  // Step 4: Update catalog feeds with publisher reference (if requested)
  let catalogUpdateResults: FeedUpdateResult[] | undefined;

  if (updateCatalogFeeds && updatedPublisherFeed.remoteItems.length > 0) {
    onProgress({
      step: 'updating-catalog',
      message: 'Adding publisher references to catalog feeds...',
      catalogProgress: { current: 0, total: updatedPublisherFeed.remoteItems.length, currentFeed: '' }
    });

    catalogUpdateResults = [];
    for (let i = 0; i < updatedPublisherFeed.remoteItems.length; i++) {
      const item = updatedPublisherFeed.remoteItems[i];

      onProgress({
        step: 'updating-catalog',
        message: `Updating ${item.title || item.feedGuid}...`,
        catalogProgress: {
          current: i + 1,
          total: updatedPublisherFeed.remoteItems.length,
          currentFeed: item.title || item.feedGuid
        }
      });

      const result = await processCatalogFeed(item, podcastGuid, feedUrl);
      catalogUpdateResults.push(result);
    }
  }

  // Complete
  onProgress({ step: 'complete', message: 'Published successfully!' });

  return {
    success: true,
    feedUrl,
    piStatus: piResult.status,
    piPageUrl: piResult.pageUrl,
    catalogHostResults,
    catalogUpdateResults,
    hostedInfo,
    updatedPublisherFeed
  };
}

/**
 * Get the current publish status for a publisher feed
 */
export function getPublishStatus(podcastGuid: string): {
  isPublished: boolean;
  feedUrl: string | null;
  hostedInfo: HostedFeedInfo | null;
} {
  const hostedInfo = getHostedFeedInfo(podcastGuid);

  if (hostedInfo) {
    return {
      isPublished: true,
      feedUrl: buildHostedUrl(hostedInfo.feedId),
      hostedInfo
    };
  }

  return {
    isPublished: false,
    feedUrl: null,
    hostedInfo: null
  };
}

/**
 * Check which catalog feeds need hosting
 */
export function getCatalogFeedsStatus(remoteItems: RemoteItem[]): {
  total: number;
  hosted: number;
  needsHosting: number;
  items: Array<{ feedGuid: string; title: string; isHosted: boolean; hasCredentials: boolean }>;
} {
  const items = remoteItems.map(item => {
    const hostedInfo = item.feedGuid ? getHostedFeedInfo(item.feedGuid) : null;
    return {
      feedGuid: item.feedGuid,
      title: item.title || item.feedGuid,
      isHosted: isMspHosted(item.feedUrl || ''),
      hasCredentials: !!hostedInfo
    };
  });

  return {
    total: items.length,
    hosted: items.filter(i => i.hasCredentials).length,
    needsHosting: items.filter(i => !i.hasCredentials).length,
    items
  };
}
