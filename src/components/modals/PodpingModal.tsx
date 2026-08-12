import { apiFetch } from '../../utils/api';
import { useState, useEffect, useRef } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { getHostedFeedInfo, buildHostedUrl } from '../../utils/hostedFeed';
import { getFeedUrlError, normalizeFeedUrl } from '../../utils/urlValidation';
import { verifyFeedUrl, isGuardRefusal } from '../../utils/verifyFeedUrl';

interface PodpingModalProps {
  onClose: () => void;
  feedGuid: string;
  medium?: string;
}

// /api/podping only confirms hivepinger accepted the ping into its queue; the Hive
// broadcast happens asynchronously. Poll /api/podping-verify until it shows up on-chain.
const VERIFY_FIRST_DELAY_MS = 3000;
const VERIFY_INTERVAL_MS = 5000;
const VERIFY_MAX_ATTEMPTS = 6;

interface VerifyState {
  status: 'idle' | 'checking' | 'landed' | 'not-seen' | 'unavailable';
  /** True when we couldn't reach Hive at all — distinct from "not configured". */
  unreachable?: boolean;
}

export function PodpingModal({ onClose, feedGuid, medium }: PodpingModalProps) {
  const [podpingUrl, setPodpingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [verifyJob, setVerifyJob] = useState<{ url: string; id: number; since: number } | null>(null);
  const verifyJobId = useRef(0);
  // Reachability pre-check (distinct from the on-chain Hive verification below):
  // a warning plus the latch that lets a second click send the ping regardless.
  const [checking, setChecking] = useState(false);
  const [reachWarning, setReachWarning] = useState<string | null>(null);
  const [bypassReachCheck, setBypassReachCheck] = useState(false);

  useEffect(() => {
    if (!feedGuid) return;
    const info = getHostedFeedInfo(feedGuid);
    if (info) {
      setPodpingUrl(buildHostedUrl(info.feedId));
    }
  }, [feedGuid]);

  // Poll Hive for the podping. Cleanup aborts the in-flight request and stops the loop,
  // so closing the modal / editing the URL / resending never leaves a stale poller.
  useEffect(() => {
    if (!verifyJob) return;

    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (attempt: number) => {
      if (cancelled) return;

      try {
        // `since` scopes the check to this send — without it a podping for the same
        // feed from an hour ago would match on the first poll and report success.
        const response = await apiFetch(
          `/api/podping-verify?url=${encodeURIComponent(verifyJob.url)}&since=${verifyJob.since}`,
          { signal: controller.signal }
        );
        if (cancelled) return;

        // Not configured on this deployment, or we've been throttled — stop quietly.
        if (response.status === 501) {
          setVerify({ status: 'unavailable' });
          return;
        }
        if (response.status === 429) {
          setVerify({ status: 'unavailable', unreachable: true });
          return;
        }
        if (!response.ok) throw new Error('Hive check failed');

        const data = await response.json();
        if (cancelled) return;

        if (data.landed) {
          setVerify({ status: 'landed' });
          return;
        }

        if (attempt >= VERIFY_MAX_ATTEMPTS) {
          setVerify({ status: 'not-seen' });
          return;
        }
      } catch {
        if (cancelled || controller.signal.aborted) return;
        if (attempt >= VERIFY_MAX_ATTEMPTS) {
          // Couldn't reach Hive — say so rather than claiming the ping didn't land.
          setVerify({ status: 'unavailable', unreachable: true });
          return;
        }
      }

      timer = setTimeout(() => poll(attempt + 1), VERIFY_INTERVAL_MS);
    };

    timer = setTimeout(() => poll(1), VERIFY_FIRST_DELAY_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [verifyJob]);

  const handleUrlChange = (value: string) => {
    setPodpingUrl(normalizeFeedUrl(value));
    // The old result refers to a different feed now.
    setVerifyJob(null);
    setVerify({ status: 'idle' });
    setMessage(null);
    setReachWarning(null);
    setBypassReachCheck(false);
  };

  const handleSubmit = async () => {
    const url = normalizeFeedUrl(podpingUrl);
    if (!url) {
      setMessage({ type: 'error', text: 'Please enter a feed URL' });
      return;
    }

    // The latch doubles as the override: set by the check below or by a server
    // refusal, and cleared whenever the URL changes.
    const force = bypassReachCheck;

    // Pinging a URL that doesn't resolve tells indexers to re-crawl nothing.
    if (!force) {
      setChecking(true);
      const reach = await verifyFeedUrl(url);
      setChecking(false);
      if (!reach.ok) {
        setReachWarning(reach.warning);
        setBypassReachCheck(true);
        return;
      }
    }
    setReachWarning(null);

    setSubmitting(true);
    setMessage(null);
    setVerifyJob(null);
    setVerify({ status: 'idle' });

    try {
      const body: { url: string; reason: string; medium?: string; force?: boolean } = { url, reason: 'update' };
      if (medium) body.medium = medium;
      if (force) body.force = true;
      const response = await apiFetch('/api/podping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: response.statusText }));
        // The server saw a block our own check missed. Surface it and arm the
        // latch, so the button becomes "Send anyway" rather than a dead end.
        if (isGuardRefusal(data)) {
          setReachWarning(data.error);
          setBypassReachCheck(true);
          return;
        }
        throw new Error(data.error || 'Podping failed');
      }
      setMessage({
        type: 'success',
        text: force
          ? 'Podping sent — but the feed was unreachable when we checked, so indexers may not be able to fetch it.'
          : 'Podping sent.'
      });
      verifyJobId.current += 1;
      setVerify({ status: 'checking' });
      setVerifyJob({ url, id: verifyJobId.current, since: Date.now() });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Podping failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const urlError = getFeedUrlError(podpingUrl);
  const noteStyle = { marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' };

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
            disabled={submitting || checking || !podpingUrl || !!urlError}
          >
            {checking
              ? 'Checking URL…'
              : submitting
                ? 'Sending…'
                : bypassReachCheck
                  ? 'Send anyway'
                  : 'Send Podping'}
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
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://example.com/feed.xml"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '4px',
            border: `1px solid ${urlError ? 'var(--error, #ef4444)' : 'var(--border-color)'}`,
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            fontFamily: 'monospace'
          }}
        />
        {urlError && (
          <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--error, #ef4444)' }}>
            {urlError}
          </div>
        )}
        {!urlError && reachWarning && (
          <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--warning-color, #f59e0b)' }}>
            ⚠ {reachWarning} Send anyway if you're sure.
          </div>
        )}
      </div>
      {message && (
        <div style={{
          color: message.type === 'error' ? 'var(--error)' : 'var(--success)',
          marginTop: '12px',
          fontSize: '0.875rem'
        }}>
          {message.type === 'success' ? `✅ ${message.text}` : message.text}
        </div>
      )}
      {verify.status === 'checking' && (
        <div style={noteStyle}>Checking Hive…</div>
      )}
      {verify.status === 'landed' && (
        <div style={{ ...noteStyle, color: 'var(--success)' }}>
          ✅ Podping received
        </div>
      )}
      {verify.status === 'not-seen' && (
        <div style={noteStyle}>
          Not received yet — it may still be queued.
        </div>
      )}
      {verify.status === 'unavailable' && verify.unreachable && (
        <div style={noteStyle}>Couldn't check Hive right now.</div>
      )}
    </ModalWrapper>
  );
}
