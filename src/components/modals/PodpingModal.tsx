import { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { getHostedFeedInfo, buildHostedUrl } from '../../utils/hostedFeed';

interface PodpingModalProps {
  onClose: () => void;
  feedGuid: string;
  medium?: string;
}

export function PodpingModal({ onClose, feedGuid, medium }: PodpingModalProps) {
  const [podpingUrl, setPodpingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!feedGuid) return;
    const info = getHostedFeedInfo(feedGuid);
    if (info) {
      setPodpingUrl(buildHostedUrl(info.feedId));
    }
  }, [feedGuid]);

  const handleSubmit = async () => {
    const url = podpingUrl.trim();
    if (!url) {
      setMessage({ type: 'error', text: 'Please enter a feed URL' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const body: { url: string; reason: string; medium?: string } = { url, reason: 'update' };
      if (medium) body.medium = medium;
      const response = await fetch('/api/podping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(data.error || 'Podping failed');
      }
      setMessage({ type: 'success', text: 'Podping sent.' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Podping failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={true}
      onClose={onClose}
      title="Send Podping"
      footer={
        <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !podpingUrl.trim()}
          >
            {submitting ? 'Sending…' : 'Send Podping'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '12px' }}>
        Notify podcast apps that a feed was updated, via Podping/Hive. Indexers re-crawl the feed when they see the ping.
      </p>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Feed URL
        </label>
        <input
          type="text"
          value={podpingUrl}
          onChange={(e) => setPodpingUrl(e.target.value)}
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
