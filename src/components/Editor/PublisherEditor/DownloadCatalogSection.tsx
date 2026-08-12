import { useState, useEffect, useRef } from 'react';
import type { PublisherFeed } from '../../../types/feed';
import { Section } from '../../Section';
import { fetchFeedFromUrl, parseRssFeed } from '../../../utils/xmlParser';
import { generateRssFeed, downloadXml } from '../../../utils/xmlGenerator';
import { getHostedFeedInfo, buildHostedUrl } from '../../../utils/hostedFeed';
import { getFeedUrlError, normalizeFeedUrl } from '../../../utils/urlValidation';
import { apiFetch } from '../../../utils/api';
import { verifyFeedUrl, isGuardRefusal, FORCED_SUBMIT_NOTE } from '../../../utils/verifyFeedUrl';

interface DownloadCatalogSectionProps {
  publisherFeed: PublisherFeed;
  /** Store-level counter, bumped whenever a different publisher feed is loaded. */
  feedInstance: number;
}

export function DownloadCatalogSection({ publisherFeed, feedInstance }: DownloadCatalogSectionProps) {
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [publisherFeedUrl, setPublisherFeedUrl] = useState('');
  const [urlValidation, setUrlValidation] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
  // Bumped to re-run the Podcast Index lookup below without touching the URL.
  // This used to be done by appending a space to publisherFeedUrl and trimming it
  // back — that string is stamped into every catalog feed's <podcast:publisher>,
  // so it must never carry whitespace even momentarily.
  const [piCheckNonce, setPiCheckNonce] = useState(0);
  // Latch: set when the reachability check warns, so a second click submits anyway.
  const [bypassVerify, setBypassVerify] = useState(false);
  const loadedInstance = useRef(feedInstance);
  const publisherFeedUrlError = getFeedUrlError(publisherFeedUrl);

  // This section stays mounted across an import, so without this the URL resolved
  // for the *previous* publisher feed would survive and get stamped into the new
  // feed's <podcast:publisher> tags. Clearing it lets the effect below re-resolve
  // from the feed that's actually loaded now.
  useEffect(() => {
    if (loadedInstance.current === feedInstance) return;
    loadedInstance.current = feedInstance;
    setPublisherFeedUrl('');
    setUrlValidation('idle');
    setSubmitResult(null);
    setBypassVerify(false);
  }, [feedInstance]);

  // Auto-populate URL from sourceUrl (imported URL) or MSP hosted URL
  // Check periodically in case user hosts from the reminder section above
  useEffect(() => {
    // Already resolved — nothing to poll for.
    if (publisherFeedUrl) return;

    const checkHostedUrl = (): boolean => {
      // First priority: use sourceUrl if the feed was imported from a URL.
      // Normalized because it traces back to a user-typed import URL and gets
      // stamped into every catalog feed's <podcast:publisher> below.
      if (publisherFeed.sourceUrl) {
        setPublisherFeedUrl(normalizeFeedUrl(publisherFeed.sourceUrl));
        return true;
      }
      // Second priority: check if hosted on MSP (in case hosted from another section)
      if (publisherFeed.podcastGuid) {
        const hostedInfo = getHostedFeedInfo(publisherFeed.podcastGuid);
        if (hostedInfo) {
          setPublisherFeedUrl(normalizeFeedUrl(buildHostedUrl(hostedInfo.feedId)));
          return true;
        }
      }
      return false;
    };

    // Check immediately; only keep polling while the URL is still unresolved.
    if (checkHostedUrl()) return;

    const interval = setInterval(() => {
      if (checkHostedUrl()) clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
  }, [publisherFeed.podcastGuid, publisherFeed.sourceUrl, publisherFeedUrl]);

  const handleSubmitToPI = async () => {
    const feedUrl = normalizeFeedUrl(publisherFeedUrl);
    if (!feedUrl) return;

    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      // Confirm the URL resolves before registering it — a broken entry sticks
      // around in Podcast Index.
      // The latch doubles as the override: set by this check or by a server
      // refusal, and cleared whenever the URL changes.
      const force = bypassVerify;
      if (!force) {
        const check = await verifyFeedUrl(feedUrl);
        if (!check.ok) {
          setSubmitResult({ success: false, message: `${check.warning} Click again to submit anyway.` });
          setBypassVerify(true);
          return;
        }
      }

      const response = await apiFetch('/api/pisubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl, ...(force ? { force: true } : {}) })
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setSubmitResult({
          success: true,
          message: `${data.message || 'Feed submitted! It may take a few minutes to be indexed.'}${force ? FORCED_SUBMIT_NOTE : ''}`
        });
        // Re-check after a short delay
        setTimeout(() => {
          setUrlValidation('idle');
          setPiCheckNonce(n => n + 1);
        }, 2000);
      } else if (isGuardRefusal(data)) {
        setSubmitResult({ success: false, message: `${data.error} Click again to submit anyway.` });
        setBypassVerify(true);
      } else {
        const errorMsg = data.error || data.details?.description || 'Failed to submit feed';
        setSubmitResult({ success: false, message: errorMsg });
      }
    } catch {
      setSubmitResult({ success: false, message: 'Failed to submit feed' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if publisher feed URL exists in Podcast Index
  useEffect(() => {
    const feedUrl = normalizeFeedUrl(publisherFeedUrl);
    if (!feedUrl) {
      setUrlValidation('idle');
      return;
    }

    // Debounce the check
    const timeoutId = setTimeout(async () => {
      setUrlValidation('checking');
      try {
        const response = await apiFetch(`/api/pisearch?q=${encodeURIComponent(feedUrl)}`);
        const data = await response.json();

        if (response.ok && data.feeds && data.feeds.length > 0) {
          // Check if any returned feed matches our URL. Normalize PI's side too —
          // a stray space in their stored URL would otherwise read as "not found"
          // and prompt the user to re-submit a feed that is already indexed.
          const found = data.feeds.some((feed: { url: string }) =>
            normalizeFeedUrl(feed.url).toLowerCase() === feedUrl.toLowerCase()
          );
          setUrlValidation(found ? 'found' : 'not-found');
        } else {
          setUrlValidation('not-found');
        }
      } catch {
        setUrlValidation('not-found');
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [publisherFeedUrl, piCheckNonce]);

  const handleDownloadFeed = async (index: number) => {
    const item = publisherFeed.remoteItems[index];
    if (!item.feedUrl) return;

    setDownloadingIndex(index);
    try {
      // Fetch and parse the feed
      const xml = await fetchFeedFromUrl(item.feedUrl);
      const album = parseRssFeed(xml);

      // Add publisher reference and update lastBuildDate
      album.publisher = {
        feedGuid: publisherFeed.podcastGuid,
        feedUrl: publisherFeedUrl
      };
      album.lastBuildDate = new Date().toUTCString();

      // Generate new XML with publisher reference
      const newXml = generateRssFeed(album);

      const safeTitle = (item.title || item.feedGuid || 'feed')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
      downloadXml(newXml, `${safeTitle}-with-publisher.xml`);
    } catch (err) {
      alert(`Failed to download feed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadingIndex(null);
    }
  };

  const handleDownloadAll = async () => {
    if (publisherFeed.remoteItems.length === 0) return;

    setDownloadingAll(true);
    // A failed feed used to vanish here — the catch below was empty, so a run
    // that downloaded nothing looked identical to one that downloaded everything.
    const failures: string[] = [];
    for (let i = 0; i < publisherFeed.remoteItems.length; i++) {
      const item = publisherFeed.remoteItems[i];
      if (!item.feedUrl) continue;

      setDownloadingIndex(i);
      try {
        // Fetch and parse the feed
        const xml = await fetchFeedFromUrl(item.feedUrl);
        const album = parseRssFeed(xml);

        // Add publisher reference and update lastBuildDate
        album.publisher = {
          feedGuid: publisherFeed.podcastGuid,
          feedUrl: publisherFeedUrl
        };
        album.lastBuildDate = new Date().toUTCString();

        // Generate new XML with publisher reference
        const newXml = generateRssFeed(album);

        const safeTitle = (item.title || item.feedGuid || 'feed')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50);
        downloadXml(newXml, `${safeTitle}-with-publisher.xml`);
        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        // Record and continue with the next feed, so one bad URL doesn't stop
        // the run — but report the failures at the end rather than silently.
        const label = item.title || item.feedUrl;
        failures.push(`${label}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    setDownloadingIndex(null);
    setDownloadingAll(false);

    if (failures.length > 0) {
      alert(
        `${failures.length} of ${publisherFeed.remoteItems.length} feeds could not be downloaded:\n\n` +
        failures.join('\n\n')
      );
    }
  };

  const hasPublisherGuid = !!publisherFeed.podcastGuid;
  const hasCatalogFeeds = publisherFeed.remoteItems.length > 0;

  return (
    <Section title="Add Publisher to Catalog Feeds" icon="&#128229;">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
        Download each catalog feed with the <code style={{
          backgroundColor: 'var(--bg-secondary)',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '13px'
        }}>&lt;podcast:publisher&gt;</code> tag automatically added, linking them to this publisher feed.
        These feeds will need to be re-uploaded to wherever you're currently hosting them.
        <strong style={{ display: 'block', marginTop: '8px', color: 'var(--text-primary)' }}>
          Note: Your publisher feed must also be submitted to the Podcast Index for the reference to resolve.
        </strong>
      </p>

      <div className="form-group" style={{ marginBottom: '16px' }}>
        <label className="form-label">Publisher Feed URL <span className="required">*</span></label>
        <input
          type="url"
          className="form-input"
          placeholder="https://example.com/publisher-feed.xml"
          value={publisherFeedUrl}
          onChange={e => {
            setPublisherFeedUrl(normalizeFeedUrl(e.target.value));
            setBypassVerify(false);
            setSubmitResult(null);
          }}
          style={publisherFeedUrlError ? { borderColor: 'var(--error, #ef4444)' } : undefined}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
          The URL where you will host this publisher feed. This URL will be included in each catalog feed's publisher reference.
        </p>
        {/* This URL is written into every catalog feed's <podcast:publisher> tag,
            so a malformed one propagates well beyond the Podcast Index submission. */}
        {publisherFeedUrlError && (
          <p style={{ color: 'var(--error, #ef4444)', fontSize: '12px', marginTop: '4px' }}>
            {publisherFeedUrlError}
          </p>
        )}
        {urlValidation === 'checking' && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
            Checking Podcast Index...
          </p>
        )}
        {urlValidation === 'found' && (
          <p style={{ color: 'var(--success-color, #22c55e)', fontSize: '12px', marginTop: '4px' }}>
            ✓ Found in Podcast Index
          </p>
        )}
        {urlValidation === 'not-found' && (
          <div style={{ marginTop: '8px' }}>
            <p style={{ color: 'var(--warning-color, #f59e0b)', fontSize: '12px', marginBottom: '8px' }}>
              ⚠ Not found in Podcast Index. The feed must be hosted and publicly accessible before submitting.
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleSubmitToPI}
              disabled={isSubmitting || !publisherFeedUrl || !!publisherFeedUrlError}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              {isSubmitting
                ? 'Submitting...'
                : bypassVerify ? 'Submit anyway' : 'Submit to Podcast Index'}
            </button>
            {submitResult && (
              <p style={{
                color: submitResult.success ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #ef4444)',
                fontSize: '12px',
                marginTop: '8px'
              }}>
                {submitResult.message}
              </p>
            )}
          </div>
        )}
      </div>

      {(!hasPublisherGuid || !publisherFeedUrl.trim() || !hasCatalogFeeds) && (
        <div style={{
          padding: '12px',
          marginBottom: '16px',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid var(--warning-color, #f59e0b)',
          borderRadius: '8px',
          color: 'var(--warning-color, #f59e0b)',
          fontSize: '14px'
        }}>
          {!hasPublisherGuid && <div>Please set a Publisher GUID in the Publisher Info section first.</div>}
          {!publisherFeedUrl.trim() && <div>Please enter the Publisher Feed URL above.</div>}
          {!hasCatalogFeeds && <div>Please add catalog feeds in the Catalog Feeds section above.</div>}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn btn-primary"
          onClick={handleDownloadAll}
          disabled={downloadingAll || !hasPublisherGuid || !publisherFeedUrl.trim() || !hasCatalogFeeds}
          style={{
            marginRight: '12px',
            opacity: (!hasPublisherGuid || !publisherFeedUrl.trim() || !hasCatalogFeeds) ? 0.5 : 1,
            cursor: (!hasPublisherGuid || !publisherFeedUrl.trim() || !hasCatalogFeeds) ? 'not-allowed' : 'pointer'
          }}
        >
          {downloadingAll ? 'Downloading...' : `Download All (${publisherFeed.remoteItems.length})`}
        </button>
      </div>

      {hasCatalogFeeds && (
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          {publisherFeed.remoteItems.map((item, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                gap: '12px',
                borderBottom: index < publisherFeed.remoteItems.length - 1 ? '1px solid var(--border-color)' : 'none',
                backgroundColor: downloadingIndex === index ? 'var(--bg-secondary)' : 'transparent'
              }}
            >
              {item.image && (
                <img
                  src={item.image}
                  alt=""
                  style={{
                    width: '40px',
                    height: item.medium === 'video' ? '22.5px' : '40px',
                    borderRadius: '4px',
                    objectFit: 'contain',
                    backgroundColor: 'var(--surface-color)'
                  }}
                  onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{item.title || 'Untitled'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {item.feedGuid}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => handleDownloadFeed(index)}
                disabled={downloadingIndex === index || !item.feedUrl || !hasPublisherGuid || !publisherFeedUrl.trim()}
                style={{
                  padding: '8px 16px',
                  opacity: (!hasPublisherGuid || !publisherFeedUrl.trim()) ? 0.5 : 1,
                  cursor: (!hasPublisherGuid || !publisherFeedUrl.trim()) ? 'not-allowed' : 'pointer'
                }}
              >
                {downloadingIndex === index ? 'Downloading...' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
