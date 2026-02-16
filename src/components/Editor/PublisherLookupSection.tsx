import { useState, useEffect, useCallback } from 'react';
import type { PublisherReference } from '../../types/feed';
import type { FeedAction } from '../../store/feedStore';
import { FIELD_INFO } from '../../data/fieldInfo';
import { InfoIcon } from '../InfoIcon';
import { Section } from '../Section';
import { apiFetch } from '../../utils/api';

interface PublisherLookupSectionProps {
  publisher: PublisherReference | undefined;
  dispatch: React.Dispatch<FeedAction>;
}

export function PublisherLookupSection({ publisher, dispatch }: PublisherLookupSectionProps) {
  const [publisherLookup, setPublisherLookup] = useState<{
    loading: boolean;
    error: string | null;
    feedTitle: string | null;
    feedImage: string | null;
  }>({ loading: false, error: null, feedTitle: null, feedImage: null });

  const [piSubmitting, setPiSubmitting] = useState(false);
  const [piSubmitResult, setPiSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  const lookupPublisherFeed = useCallback(async (feedUrl: string) => {
    if (!feedUrl) {
      setPublisherLookup({ loading: false, error: null, feedTitle: null, feedImage: null });
      return;
    }

    if (!feedUrl.startsWith('http://') && !feedUrl.startsWith('https://')) {
      setPublisherLookup({ loading: false, error: null, feedTitle: null, feedImage: null });
      return;
    }

    setPublisherLookup({ loading: true, error: null, feedTitle: null, feedImage: null });

    try {
      const response = await apiFetch(`/api/pisearch?q=${encodeURIComponent(feedUrl)}`);
      const data = await response.json();

      if (!response.ok) {
        setPublisherLookup({ loading: false, error: data.error || 'Feed not found', feedTitle: null, feedImage: null });
        return;
      }

      const feed = data.feeds?.[0];
      if (feed?.podcastGuid) {
        dispatch({
          type: 'UPDATE_ALBUM',
          payload: {
            publisher: {
              feedGuid: feed.podcastGuid,
              feedUrl: feedUrl
            }
          }
        });
        setPublisherLookup({ loading: false, error: null, feedTitle: feed.title || null, feedImage: feed.image || null });
      } else {
        setPublisherLookup({ loading: false, error: 'Feed not found in Podcast Index', feedTitle: null, feedImage: null });
      }
    } catch {
      setPublisherLookup({ loading: false, error: 'Failed to lookup feed', feedTitle: null, feedImage: null });
    }
  }, [dispatch]);

  // Debounce publisher URL lookup
  useEffect(() => {
    const url = publisher?.feedUrl;
    if (!url) {
      setPublisherLookup({ loading: false, error: null, feedTitle: null, feedImage: null });
      return;
    }

    const timer = setTimeout(() => {
      lookupPublisherFeed(url);
    }, 500);

    return () => clearTimeout(timer);
  }, [publisher?.feedUrl, lookupPublisherFeed]);

  const handleSubmitToPI = async () => {
    const feedUrl = publisher?.feedUrl;
    if (!feedUrl?.trim()) return;
    setPiSubmitting(true);
    setPiSubmitResult(null);
    try {
      const proxyRes = await apiFetch(`/api/proxy-feed?url=${encodeURIComponent(feedUrl)}`);
      if (!proxyRes.ok) {
        setPiSubmitResult({ success: false, message: 'Could not fetch URL - check the address' });
        return;
      }
      const content = await proxyRes.text();
      if (!content.includes('<rss') && !content.includes('<feed') && !content.includes('<channel')) {
        setPiSubmitResult({ success: false, message: 'URL does not appear to be an RSS feed' });
        return;
      }

      const response = await apiFetch('/api/pisubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: feedUrl })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setPiSubmitResult({ success: true, message: 'Submitted! May take a few minutes to index.' });
      } else {
        setPiSubmitResult({ success: false, message: data.error || data.details?.description || 'Failed to submit' });
      }
    } catch {
      setPiSubmitResult({ success: false, message: 'Failed to submit' });
    } finally {
      setPiSubmitting(false);
    }
  };

  return (
    <Section title="Publisher Feed (Advanced)" icon="&#127970;">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
        Add this release to a publisher catalog by entering the publisher's feed URL (must be in Podcast Index).
      </p>
      <div className="form-group">
        <label className="form-label">Publisher Feed URL<InfoIcon text={FIELD_INFO.publisherUrl} /></label>
        <input
          type="url"
          className="form-input"
          placeholder="https://example.com/publisher-feed.xml"
          value={publisher?.feedUrl || ''}
          onChange={e => dispatch({
            type: 'UPDATE_ALBUM',
            payload: {
              publisher: {
                feedGuid: '',
                feedUrl: e.target.value
              }
            }
          })}
        />
        {publisherLookup.loading && (
          <p style={{ color: 'var(--text-tertiary)', marginTop: '8px', fontSize: '12px' }}>
            Looking up feed in Podcast Index...
          </p>
        )}
        {publisherLookup.error && (
          <div style={{ marginTop: '8px' }}>
            <p style={{ color: 'var(--warning-color, #f59e0b)', fontSize: '12px', marginBottom: '8px' }}>
              ⚠ {publisherLookup.error}
            </p>
            {publisherLookup.error === 'Feed not found in Podcast Index' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleSubmitToPI}
                  disabled={piSubmitting}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  {piSubmitting ? 'Submitting...' : 'Submit to Podcast Index'}
                </button>
                {piSubmitResult && (
                  <span style={{
                    color: piSubmitResult.success ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #ef4444)',
                    fontSize: '12px'
                  }}>
                    {piSubmitResult.message}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {publisher?.feedGuid && !publisherLookup.loading && !publisherLookup.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
            {publisherLookup.feedImage && (
              <img
                src={publisherLookup.feedImage}
                alt=""
                style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }}
              />
            )}
            <p style={{ color: 'var(--success)', fontSize: '12px', margin: 0 }}>
              ✓ Found: {publisherLookup.feedTitle || 'Publisher Feed'}
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
