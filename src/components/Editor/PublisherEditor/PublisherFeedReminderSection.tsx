import { useState } from 'react';
import type { PublisherFeed } from '../../../types/feed';
import { Section } from '../../Section';
import { generatePublisherRssFeed, downloadXml } from '../../../utils/xmlGenerator';
import {
  createHostedFeed,
  createHostedFeedWithNostr,
  buildHostedUrl,
  generateEditToken,
  saveHostedFeedInfo,
  getHostedFeedInfo
} from '../../../utils/hostedFeed';
import { hasSigner } from '../../../utils/nostrSigner';
import { useNostr } from '../../../store/nostrStore';

interface PublisherFeedReminderSectionProps {
  publisherFeed: PublisherFeed;
}

export function PublisherFeedReminderSection({ publisherFeed }: PublisherFeedReminderSectionProps) {
  const { state: nostrState } = useNostr();
  const [isHosting, setIsHosting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  const [selfHostedUrl, setSelfHostedUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [piResult, setPiResult] = useState<{ success: boolean; message: string } | null>(null);

  const podcastGuid = publisherFeed.podcastGuid;
  const existingInfo = podcastGuid ? getHostedFeedInfo(podcastGuid) : null;
  const isAlreadyHosted = !!existingInfo;

  const handleHostOnMSP = async () => {
    if (!podcastGuid) {
      setResult({ success: false, message: 'Please set a Publisher GUID first' });
      return;
    }

    setIsHosting(true);
    setResult(null);

    try {
      const xml = generatePublisherRssFeed({ ...publisherFeed, lastBuildDate: new Date().toUTCString() });
      const title = publisherFeed.title || 'Publisher Feed';
      const editToken = generateEditToken();
      const shouldLinkNostr = nostrState.isLoggedIn && nostrState.user?.pubkey && hasSigner();

      let response;
      if (shouldLinkNostr) {
        response = await createHostedFeedWithNostr(xml, title, podcastGuid, editToken);
        saveHostedFeedInfo(podcastGuid, {
          feedId: response.feedId,
          editToken,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          ownerPubkey: nostrState.user?.pubkey,
          linkedAt: Date.now()
        });
      } else {
        response = await createHostedFeed(xml, title, podcastGuid, editToken);
        saveHostedFeedInfo(podcastGuid, {
          feedId: response.feedId,
          editToken,
          createdAt: Date.now(),
          lastUpdated: Date.now()
        });
      }

      const feedUrl = response.url;

      // Auto-submit to Podcast Index
      try {
        await fetch('/api/pisubmit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: feedUrl })
        });
      } catch {
        // Silent fail for PI submission - feed is still hosted
      }

      setResult({
        success: true,
        message: 'Publisher feed hosted and submitted to Podcast Index!',
        url: feedUrl
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to host feed';
      if (errMsg.includes('already exists')) {
        const url = buildHostedUrl(podcastGuid);
        setResult({
          success: true,
          message: 'Feed already hosted on MSP',
          url
        });
      } else {
        setResult({ success: false, message: errMsg });
      }
    } finally {
      setIsHosting(false);
    }
  };

  const handleDownload = () => {
    const xml = generatePublisherRssFeed({ ...publisherFeed, lastBuildDate: new Date().toUTCString() });
    const safeTitle = (publisherFeed.title || 'publisher-feed')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    downloadXml(xml, `${safeTitle}.xml`);
  };

  const handleSubmitToPodcastIndex = async () => {
    if (!selfHostedUrl.trim()) return;

    setIsSubmitting(true);
    setPiResult(null);

    try {
      const response = await fetch(`/api/pubnotify?url=${encodeURIComponent(selfHostedUrl.trim())}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit to Podcast Index');
      }

      setPiResult({ success: true, message: 'Feed submitted to Podcast Index! It may take a moment to appear.' });
    } catch (err) {
      setPiResult({ success: false, message: err instanceof Error ? err.message : 'Failed to submit' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Section title="Before adding the publisher feed to the catalog feeds" icon="&#9888;">
      <div style={{
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <p style={{ margin: 0, marginBottom: '16px', fontWeight: 500 }}>
          Your publisher feed must be hosted and submitted to the Podcast Index before continuing.
        </p>

        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Host it yourself
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleDownload}
              style={{ width: '100%' }}
            >
              Download Feed
            </button>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Or let MSP handle it
            </p>
            <button
              className="btn btn-secondary"
              onClick={handleHostOnMSP}
              disabled={isHosting || !podcastGuid || isAlreadyHosted}
              style={{ width: '100%' }}
            >
              {isHosting ? 'Hosting...' : isAlreadyHosted ? 'Already Hosted' : 'Host on MSP'}
            </button>
          </div>
        </div>

        {/* Submit self-hosted feed to Podcast Index */}
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(139, 92, 246, 0.2)' }}>
          <p style={{ margin: 0, marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Already hosting your feed? Submit the URL to Podcast Index.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={selfHostedUrl}
              onChange={(e) => setSelfHostedUrl(e.target.value)}
              placeholder="https://example.com/publisher-feed.xml"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontFamily: 'monospace'
              }}
            />
            <button
              className="btn btn-secondary"
              onClick={handleSubmitToPodcastIndex}
              disabled={isSubmitting || !selfHostedUrl.trim()}
            >
              {isSubmitting ? 'Submitting...' : 'Submit to PI'}
            </button>
          </div>
          {piResult && (
            <p style={{
              color: piResult.success ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #ef4444)',
              fontSize: '13px',
              marginTop: '8px',
              margin: '8px 0 0 0'
            }}>
              {piResult.success ? '✓ ' : ''}{piResult.message}
            </p>
          )}
        </div>

        {isAlreadyHosted && existingInfo && (
          <p style={{ color: 'var(--success-color, #22c55e)', fontSize: '13px', marginTop: '8px' }}>
            ✓ Hosted at:{' '}
            <a
              href={buildHostedUrl(existingInfo.feedId)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#ff9900' }}
            >
              {buildHostedUrl(existingInfo.feedId)}
            </a>
          </p>
        )}

        {result && (
          <p style={{
            color: result.success ? 'var(--success-color, #22c55e)' : 'var(--danger-color, #ef4444)',
            fontSize: '13px',
            marginTop: '8px'
          }}>
            {result.success ? '✓ ' : ''}{result.message}
            {result.url && (
              <>
                {' '}
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#ff9900' }}
                >
                  View Feed
                </a>
              </>
            )}
          </p>
        )}

        {!podcastGuid && (
          <p style={{ color: 'var(--danger-color, #ef4444)', fontSize: '13px', marginTop: '8px' }}>
            Please set a Publisher GUID in the Publisher Info section first.
          </p>
        )}
      </div>
    </Section>
  );
}
