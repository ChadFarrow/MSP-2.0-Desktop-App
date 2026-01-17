import { useState, useEffect } from 'react';
import type { PublisherFeed } from '../../../types/feed';
import { Section } from '../../Section';
import { fetchFeedFromUrl, parseRssFeed } from '../../../utils/xmlParser';
import { generateRssFeed, downloadXml } from '../../../utils/xmlGenerator';

interface DownloadCatalogSectionProps {
  publisherFeed: PublisherFeed;
}

export function DownloadCatalogSection({ publisherFeed }: DownloadCatalogSectionProps) {
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [publisherFeedUrl, setPublisherFeedUrl] = useState('');
  const [urlValidation, setUrlValidation] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmitToPI = async () => {
    if (!publisherFeedUrl.trim()) return;

    setIsSubmitting(true);
    setSubmitResult(null);
    try {
      const response = await fetch('/api/pisubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: publisherFeedUrl })
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setSubmitResult({ success: true, message: data.message || 'Feed submitted! It may take a few minutes to be indexed.' });
        // Re-check after a short delay
        setTimeout(() => {
          setUrlValidation('idle');
          setPublisherFeedUrl(prev => prev + ' ');
          setTimeout(() => setPublisherFeedUrl(prev => prev.trim()), 10);
        }, 2000);
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
    if (!publisherFeedUrl.trim()) {
      setUrlValidation('idle');
      return;
    }

    // Debounce the check
    const timeoutId = setTimeout(async () => {
      setUrlValidation('checking');
      try {
        const response = await fetch(`/api/pisearch?q=${encodeURIComponent(publisherFeedUrl)}`);
        const data = await response.json();

        if (response.ok && data.feeds && data.feeds.length > 0) {
          // Check if any returned feed matches our URL
          const found = data.feeds.some((feed: { url: string }) =>
            feed.url.toLowerCase() === publisherFeedUrl.toLowerCase()
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
  }, [publisherFeedUrl]);

  const handleDownloadFeed = async (index: number) => {
    const item = publisherFeed.remoteItems[index];
    if (!item.feedUrl) return;

    setDownloadingIndex(index);
    try {
      // Fetch and parse the feed
      const xml = await fetchFeedFromUrl(item.feedUrl);
      const album = parseRssFeed(xml);

      // Add publisher reference
      album.publisher = {
        feedGuid: publisherFeed.podcastGuid,
        feedUrl: publisherFeedUrl
      };

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
    for (let i = 0; i < publisherFeed.remoteItems.length; i++) {
      const item = publisherFeed.remoteItems[i];
      if (!item.feedUrl) continue;

      setDownloadingIndex(i);
      try {
        // Fetch and parse the feed
        const xml = await fetchFeedFromUrl(item.feedUrl);
        const album = parseRssFeed(xml);

        // Add publisher reference
        album.publisher = {
          feedGuid: publisherFeed.podcastGuid,
          feedUrl: publisherFeedUrl
        };

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
      } catch {
        // Continue with next feed
      }
    }
    setDownloadingIndex(null);
    setDownloadingAll(false);
  };

  if (publisherFeed.remoteItems.length === 0) {
    return null;
  }

  const hasPublisherGuid = !!publisherFeed.podcastGuid;

  return (
    <Section title="Add Publisher to Catalog Feeds" icon="&#128229;">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
        Download each catalog feed with the <code style={{
          backgroundColor: 'var(--bg-secondary)',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '13px'
        }}>&lt;podcast:publisher&gt;</code> tag automatically added, linking them to this publisher feed.
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
          onChange={e => setPublisherFeedUrl(e.target.value)}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
          The URL where you will host this publisher feed. This URL will be included in each catalog feed's publisher reference.
        </p>
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
              disabled={isSubmitting}
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              {isSubmitting ? 'Submitting...' : 'Submit to Podcast Index'}
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

      {(!hasPublisherGuid || !publisherFeedUrl.trim()) && (
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
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn btn-primary"
          onClick={handleDownloadAll}
          disabled={downloadingAll || !hasPublisherGuid || !publisherFeedUrl.trim()}
          style={{
            marginRight: '12px',
            opacity: (!hasPublisherGuid || !publisherFeedUrl.trim()) ? 0.5 : 1,
            cursor: (!hasPublisherGuid || !publisherFeedUrl.trim()) ? 'not-allowed' : 'pointer'
          }}
        >
          {downloadingAll ? 'Downloading...' : `Download All (${publisherFeed.remoteItems.length})`}
        </button>
      </div>

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
                  height: '40px',
                  borderRadius: '4px',
                  objectFit: 'cover'
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
    </Section>
  );
}
