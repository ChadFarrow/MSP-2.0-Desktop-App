import { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { getHostedFeedInfo, buildHostedUrl } from '../../utils/hostedFeed';

interface PodcastIndexModalProps {
  onClose: () => void;
  feedGuid: string;
}

export function PodcastIndexModal({ onClose, feedGuid }: PodcastIndexModalProps) {
  const [podcastIndexUrl, setPodcastIndexUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [podcastIndexPageUrl, setPodcastIndexPageUrl] = useState<string | null>(null);

  // Auto-populate URL from hosted feed info if available
  useEffect(() => {
    if (!feedGuid) return;
    const info = getHostedFeedInfo(feedGuid);
    if (info) {
      setPodcastIndexUrl(buildHostedUrl(info.feedId));
    }
  }, [feedGuid]);

  const handleSubmit = async () => {
    if (!podcastIndexUrl.trim()) {
      setMessage({ type: 'error', text: 'Please enter a feed URL' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const params = new URLSearchParams({ url: podcastIndexUrl.trim() });
      if (feedGuid) params.set('guid', feedGuid);
      const response = await fetch(`/api/pubnotify?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit to Podcast Index');
      }

      if (data.podcastIndexUrl) {
        setPodcastIndexPageUrl(data.podcastIndexUrl);
        setMessage({ type: 'success', text: 'Feed added to Podcast Index!' });
      } else {
        const searchUrl = `https://podcastindex.org/search?q=${encodeURIComponent(podcastIndexUrl.trim())}`;
        setPodcastIndexPageUrl(searchUrl);
        setMessage({ type: 'success', text: 'Feed submitted! It may take a moment to appear in the index.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to submit to Podcast Index' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={true}
      onClose={onClose}
      title="Submit to Podcast Index"
      footer={
        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !podcastIndexUrl.trim()}
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      }
    >
      <ul style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px', paddingLeft: '20px' }}>
        <li style={{ marginBottom: '8px' }}><strong>New feed?</strong> Submit its URL to get indexed and discoverable in apps like Fountain, Castamatic, and others.</li>
        <li><strong>Existing feed?</strong> Re-submit the same URL to notify Podcast Index to re-crawl and pick up your latest changes.</li>
      </ul>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Feed URL
        </label>
        <input
          type="text"
          value={podcastIndexUrl}
          onChange={(e) => setPodcastIndexUrl(e.target.value)}
          placeholder="https://example.com/feed.xml"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            fontFamily: 'monospace'
          }}
        />
      </div>
      {podcastIndexPageUrl && (
        <div style={{
          marginBottom: '12px',
          padding: '12px',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderRadius: '8px',
          border: '1px solid var(--success)'
        }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)' }}>
            View on Podcast Index
          </label>
          <a
            href={podcastIndexPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.875rem', color: '#3b82f6', wordBreak: 'break-all' }}
          >
            {podcastIndexPageUrl}
          </a>
        </div>
      )}
      <a
        href="https://podcastindex.org/add"
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: '0.75rem', color: '#3b82f6' }}
      >
        Add feed manually on podcastindex.org →
      </a>

      {message && (
        <div style={{
          color: message.type === 'error' ? 'var(--error)' : 'var(--success)',
          marginTop: '12px',
          fontSize: '0.875rem'
        }}>
          {message.text}
        </div>
      )}
    </ModalWrapper>
  );
}
