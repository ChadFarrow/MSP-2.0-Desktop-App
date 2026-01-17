import { useState, useEffect } from 'react';
import type { PublisherFeed } from '../../../types/feed';
import { Section } from '../../Section';
import { InfoIcon } from '../../InfoIcon';
import { useNostr } from '../../../store/nostrStore';
import { useFeed } from '../../../store/feedStore';
import {
  publishPublisherFeed,
  getPublishStatus,
  getCatalogFeedsStatus,
  type PublishProgress,
  type PublishResult
} from '../../../utils/publisherPublish';
import { downloadHostedFeedBackup, type HostedFeedInfo } from '../../../utils/hostedFeed';
import { publisherStorage } from '../../../utils/storage';

interface PublishSectionProps {
  publisherFeed: PublisherFeed;
}

type StepStatus = 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped';

interface StepState {
  hostingCatalog: StepStatus;
  hosting: StepStatus;
  notifying: StepStatus;
  updatingCatalog: StepStatus;
}

export function PublishSection({ publisherFeed }: PublishSectionProps) {
  const { state: nostrState } = useNostr();
  const { dispatch } = useFeed();
  const isLoggedIn = nostrState.isLoggedIn;

  // Publish state
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [stepStates, setStepStates] = useState<StepState>({
    hostingCatalog: 'pending',
    hosting: 'pending',
    notifying: 'pending',
    updatingCatalog: 'pending'
  });

  // Options
  const [hostCatalogFeeds, setHostCatalogFeeds] = useState(true);
  const [updateCatalogFeeds, setUpdateCatalogFeeds] = useState(true);
  const [linkNostr, setLinkNostr] = useState(true);

  // Token acknowledgment (for first-time publish)
  const [tokenAcknowledged, setTokenAcknowledged] = useState(false);
  const [pendingHostedInfo, setPendingHostedInfo] = useState<HostedFeedInfo | null>(null);

  // Current status
  const [status, setStatus] = useState(() => getPublishStatus(publisherFeed.podcastGuid));
  const [catalogStatus, setCatalogStatus] = useState(() => getCatalogFeedsStatus(publisherFeed.remoteItems));

  // Refresh status when podcastGuid or remoteItems change
  useEffect(() => {
    setStatus(getPublishStatus(publisherFeed.podcastGuid));
    setCatalogStatus(getCatalogFeedsStatus(publisherFeed.remoteItems));
  }, [publisherFeed.podcastGuid, publisherFeed.remoteItems]);

  const isPublished = status.isPublished;
  const feedUrl = status.feedUrl;
  const hostedInfo = status.hostedInfo;
  const isNostrLinked = hostedInfo?.ownerPubkey && nostrState.user?.pubkey === hostedInfo.ownerPubkey;

  // Check if we have enough info to publish
  const canPublish = publisherFeed.podcastGuid && publisherFeed.title;

  // Update step states based on progress
  useEffect(() => {
    if (!progress) return;

    setStepStates(prev => {
      const newState = { ...prev };

      switch (progress.step) {
        case 'hosting-catalog':
          newState.hostingCatalog = 'in-progress';
          break;
        case 'hosting':
          if (hostCatalogFeeds && catalogStatus.needsHosting > 0) {
            newState.hostingCatalog = 'complete';
          }
          newState.hosting = 'in-progress';
          break;
        case 'notifying':
          newState.hostingCatalog = hostCatalogFeeds && catalogStatus.needsHosting > 0 ? 'complete' : 'skipped';
          newState.hosting = 'complete';
          newState.notifying = 'in-progress';
          break;
        case 'updating-catalog':
          newState.hostingCatalog = hostCatalogFeeds && catalogStatus.needsHosting > 0 ? 'complete' : 'skipped';
          newState.hosting = 'complete';
          newState.notifying = 'complete';
          newState.updatingCatalog = 'in-progress';
          break;
        case 'complete':
          newState.hostingCatalog = hostCatalogFeeds && catalogStatus.needsHosting > 0 ? 'complete' : 'skipped';
          newState.hosting = 'complete';
          newState.notifying = 'complete';
          newState.updatingCatalog = updateCatalogFeeds && publisherFeed.remoteItems.length > 0 ? 'complete' : 'skipped';
          break;
        case 'error':
          // Keep current states, error will be shown separately
          break;
      }

      return newState;
    });
  }, [progress, hostCatalogFeeds, updateCatalogFeeds, catalogStatus.needsHosting, publisherFeed.remoteItems.length]);

  const handlePublish = async () => {
    // For first-time publish without Nostr, require token acknowledgment
    if (!isPublished && !isLoggedIn && !tokenAcknowledged) {
      return;
    }

    // Save to local storage first
    publisherStorage.save(publisherFeed);

    setIsPublishing(true);
    setPublishResult(null);
    setStepStates({
      hostingCatalog: 'pending',
      hosting: 'pending',
      notifying: 'pending',
      updatingCatalog: 'pending'
    });

    const result = await publishPublisherFeed(publisherFeed, {
      hostCatalogFeeds: hostCatalogFeeds && catalogStatus.needsHosting > 0,
      updateCatalogFeeds: updateCatalogFeeds && publisherFeed.remoteItems.length > 0,
      linkNostr: isLoggedIn && linkNostr,
      nostrPubkey: nostrState.user?.pubkey,
      onProgress: setProgress
    });

    setPublishResult(result);
    setIsPublishing(false);

    if (result.success) {
      // Refresh status
      setStatus(getPublishStatus(publisherFeed.podcastGuid));
      setCatalogStatus(getCatalogFeedsStatus(publisherFeed.remoteItems));

      // If this was a first-time publish, store the hosted info for token display
      if (!isPublished && result.hostedInfo) {
        setPendingHostedInfo(result.hostedInfo);
      }

      // Update the publisher feed in the store with new catalog URLs
      if (result.updatedPublisherFeed) {
        dispatch({ type: 'SET_PUBLISHER_FEED', payload: result.updatedPublisherFeed });
      }
    } else {
      // Set error state on the current step
      const currentStep = progress?.step;
      setStepStates(prev => ({
        ...prev,
        ...(currentStep === 'hosting-catalog' && { hostingCatalog: 'error' }),
        ...(currentStep === 'hosting' && { hosting: 'error' }),
        ...(currentStep === 'notifying' && { notifying: 'error' }),
        ...(currentStep === 'updating-catalog' && { updatingCatalog: 'error' })
      }));
    }
  };

  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'pending': return <span style={{ color: 'var(--text-secondary)' }}>○</span>;
      case 'in-progress': return <span style={{ color: 'var(--primary-color)' }}>◐</span>;
      case 'complete': return <span style={{ color: 'var(--success-color)' }}>✓</span>;
      case 'error': return <span style={{ color: 'var(--danger-color)' }}>✗</span>;
      case 'skipped': return <span style={{ color: 'var(--text-secondary)' }}>–</span>;
    }
  };

  const getCatalogHostSummary = () => {
    if (!publishResult?.catalogHostResults) return 'Complete';

    const hosted = publishResult.catalogHostResults.filter(r => r.status === 'hosted').length;
    const skipped = publishResult.catalogHostResults.filter(r => r.status === 'skipped').length;
    const errors = publishResult.catalogHostResults.filter(r => r.status === 'error').length;

    const parts = [];
    if (hosted > 0) parts.push(`${hosted} hosted`);
    if (skipped > 0) parts.push(`${skipped} existed`);
    if (errors > 0) parts.push(`${errors} failed`);

    return parts.join(', ') || 'Complete';
  };

  const getCatalogUpdateSummary = () => {
    if (!publishResult?.catalogUpdateResults) return 'Complete';

    const updated = publishResult.catalogUpdateResults.filter(r => r.status === 'updated').length;
    const downloaded = publishResult.catalogUpdateResults.filter(r => r.status === 'downloaded').length;
    const errors = publishResult.catalogUpdateResults.filter(r => r.status === 'error').length;

    const parts = [];
    if (updated > 0) parts.push(`${updated} updated`);
    if (downloaded > 0) parts.push(`${downloaded} downloaded`);
    if (errors > 0) parts.push(`${errors} failed`);

    return parts.join(', ') || 'Complete';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Show token save UI for first-time publish when not logged in
  const showTokenSaveUI = !isPublished && !isLoggedIn && !tokenAcknowledged;
  const showNewTokenInfo = pendingHostedInfo && !isLoggedIn;

  return (
    <Section title="Publish" icon="&#128640;">
      <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
        {isPublished
          ? 'Your publisher feed is hosted on MSP. Click Update to push your latest changes.'
          : 'Host your publisher feed on MSP, notify Podcast Index, and optionally update your catalog feeds with publisher references.'}
      </p>

      {/* Progress Steps */}
      <div style={{
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '16px'
      }}>
        {/* Step 1: Host Catalog Feeds */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: stepStates.hostingCatalog === 'in-progress' ? 'var(--bg-secondary)' : 'transparent',
          opacity: catalogStatus.needsHosting === 0 ? 0.5 : 1
        }}>
          <span style={{ width: '24px', fontSize: '16px' }}>{getStepIcon(stepStates.hostingCatalog)}</span>
          <span style={{ flex: 1, fontWeight: 500 }}>
            Host catalog feeds
            {catalogStatus.needsHosting > 0 && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                {' '}({catalogStatus.needsHosting} of {catalogStatus.total})
              </span>
            )}
          </span>
          <span style={{
            fontSize: '13px',
            color: stepStates.hostingCatalog === 'complete' ? 'var(--success-color)' :
              stepStates.hostingCatalog === 'error' ? 'var(--danger-color)' :
                'var(--text-secondary)'
          }}>
            {catalogStatus.needsHosting === 0 ? 'All hosted' :
              stepStates.hostingCatalog === 'in-progress' ? (progress?.catalogProgress
                ? `${progress.catalogProgress.current}/${progress.catalogProgress.total}`
                : 'Processing...') :
              stepStates.hostingCatalog === 'complete' ? getCatalogHostSummary() :
              stepStates.hostingCatalog === 'error' ? 'Failed' :
              stepStates.hostingCatalog === 'skipped' ? 'Skipped' : 'Not started'}
          </span>
        </div>

        {/* Step 2: Host Publisher Feed on MSP */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: stepStates.hosting === 'in-progress' ? 'var(--bg-secondary)' : 'transparent'
        }}>
          <span style={{ width: '24px', fontSize: '16px' }}>{getStepIcon(stepStates.hosting)}</span>
          <span style={{ flex: 1, fontWeight: 500 }}>Host publisher feed</span>
          <span style={{
            fontSize: '13px',
            color: stepStates.hosting === 'complete' ? 'var(--success-color)' :
              stepStates.hosting === 'error' ? 'var(--danger-color)' :
                'var(--text-secondary)'
          }}>
            {stepStates.hosting === 'pending' ? 'Not started' :
              stepStates.hosting === 'in-progress' ? (isPublished ? 'Updating...' : 'Creating...') :
              stepStates.hosting === 'complete' ? 'Complete' : 'Failed'}
          </span>
        </div>

        {/* Step 3: Notify Podcast Index */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: stepStates.notifying === 'in-progress' ? 'var(--bg-secondary)' : 'transparent'
        }}>
          <span style={{ width: '24px', fontSize: '16px' }}>{getStepIcon(stepStates.notifying)}</span>
          <span style={{ flex: 1, fontWeight: 500 }}>Notify Podcast Index</span>
          <span style={{
            fontSize: '13px',
            color: stepStates.notifying === 'complete' ? 'var(--success-color)' :
              stepStates.notifying === 'error' ? 'var(--danger-color)' :
                'var(--text-secondary)'
          }}>
            {stepStates.notifying === 'pending' ? 'Not started' :
              stepStates.notifying === 'in-progress' ? 'Notifying...' :
              stepStates.notifying === 'complete' ? (publishResult?.piStatus === 'indexed' ? 'Indexed' : 'Notified') : 'Failed'}
          </span>
        </div>

        {/* Step 4: Update Catalog Feeds with Publisher Reference */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          backgroundColor: stepStates.updatingCatalog === 'in-progress' ? 'var(--bg-secondary)' : 'transparent',
          opacity: publisherFeed.remoteItems.length === 0 ? 0.5 : 1
        }}>
          <span style={{ width: '24px', fontSize: '16px' }}>{getStepIcon(stepStates.updatingCatalog)}</span>
          <span style={{ flex: 1, fontWeight: 500 }}>
            Add publisher references
            {publisherFeed.remoteItems.length > 0 && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                {' '}({publisherFeed.remoteItems.length})
              </span>
            )}
          </span>
          <span style={{
            fontSize: '13px',
            color: stepStates.updatingCatalog === 'complete' ? 'var(--success-color)' :
              stepStates.updatingCatalog === 'error' ? 'var(--danger-color)' :
                'var(--text-secondary)'
          }}>
            {publisherFeed.remoteItems.length === 0 ? 'No feeds' :
              stepStates.updatingCatalog === 'in-progress' ? (progress?.catalogProgress
                ? `${progress.catalogProgress.current}/${progress.catalogProgress.total}`
                : 'Processing...') :
              stepStates.updatingCatalog === 'complete' ? getCatalogUpdateSummary() :
              stepStates.updatingCatalog === 'error' ? 'Failed' :
              stepStates.updatingCatalog === 'skipped' ? 'Skipped' : 'Not started'}
          </span>
        </div>
      </div>

      {/* Options */}
      {!isPublishing && (
        <div style={{ marginBottom: '16px' }}>
          {catalogStatus.needsHosting > 0 && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '8px',
              backgroundColor: hostCatalogFeeds ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
              borderRadius: '4px',
              border: hostCatalogFeeds ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
            }}>
              <input
                type="checkbox"
                checked={hostCatalogFeeds}
                onChange={(e) => setHostCatalogFeeds(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ color: hostCatalogFeeds ? '#3b82f6' : 'var(--text-primary)' }}>
                Host {catalogStatus.needsHosting} catalog feed{catalogStatus.needsHosting > 1 ? 's' : ''} on MSP
              </span>
              <InfoIcon text="Fetches each catalog feed from its current URL and hosts it on MSP. This gives you edit credentials for those feeds." />
            </label>
          )}

          {publisherFeed.remoteItems.length > 0 && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              <input
                type="checkbox"
                checked={updateCatalogFeeds}
                onChange={(e) => setUpdateCatalogFeeds(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span>Add publisher references to catalog feeds</span>
              <InfoIcon text="Adds a <podcast:publisher> tag to each catalog feed, linking them back to this publisher feed. MSP-hosted feeds with saved credentials are updated automatically; others are downloaded for manual upload." />
            </label>
          )}

          {isLoggedIn && !isPublished && (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '8px',
              backgroundColor: linkNostr ? 'rgba(139, 92, 246, 0.1)' : 'transparent',
              borderRadius: '4px',
              border: linkNostr ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid transparent'
            }}>
              <input
                type="checkbox"
                checked={linkNostr}
                onChange={(e) => setLinkNostr(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ color: linkNostr ? '#a78bfa' : 'var(--text-primary)' }}>
                Link to my Nostr identity
              </span>
              <InfoIcon text="Link your Nostr identity to this feed so you can edit it from any device without needing the edit token." />
            </label>
          )}
        </div>
      )}

      {/* Token Save Warning (first-time publish without Nostr) */}
      {showTokenSaveUI && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '8px',
          border: '1px solid var(--warning-color, #f59e0b)'
        }}>
          <p style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--warning-color, #f59e0b)',
            marginBottom: '8px'
          }}>
            Important: Save your edit token
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            You'll need an edit token to update this feed later. The token will be shown after publishing.
            Make sure to save it somewhere safe!
          </p>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '8px',
            backgroundColor: tokenAcknowledged ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
            borderRadius: '4px',
            border: tokenAcknowledged ? '1px solid var(--success-color)' : '1px solid var(--border-color)'
          }}>
            <input
              type="checkbox"
              checked={tokenAcknowledged}
              onChange={(e) => setTokenAcknowledged(e.target.checked)}
              style={{ width: '16px', height: '16px' }}
            />
            <span>I understand I need to save my edit token</span>
          </label>
        </div>
      )}

      {/* Show new token after first publish */}
      {showNewTokenInfo && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '8px',
          border: '1px solid var(--warning-color, #f59e0b)'
        }}>
          <p style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--warning-color, #f59e0b)',
            marginBottom: '8px'
          }}>
            Save your edit token now!
          </p>
          <input
            type="text"
            value={pendingHostedInfo.editToken}
            readOnly
            onClick={(e) => (e.target as HTMLInputElement).select()}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '4px',
              border: '1px solid var(--warning-color, #f59e0b)',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontFamily: 'monospace',
              marginBottom: '12px'
            }}
          />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => copyToClipboard(pendingHostedInfo.editToken)}
            >
              Copy Token
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                downloadHostedFeedBackup(
                  pendingHostedInfo.feedId,
                  pendingHostedInfo.editToken,
                  publisherFeed.title || 'Publisher Feed',
                  publisherFeed.podcastGuid
                );
              }}
            >
              Download Backup
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {publishResult && !publishResult.success && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderRadius: '8px',
          border: '1px solid var(--danger-color)'
        }}>
          <p style={{ fontSize: '14px', color: 'var(--danger-color)' }}>
            {publishResult.error || 'An error occurred during publishing'}
          </p>
        </div>
      )}

      {/* Publish Button */}
      <button
        className="btn btn-primary"
        onClick={handlePublish}
        disabled={isPublishing || !canPublish || showTokenSaveUI}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          marginBottom: '16px'
        }}
      >
        {isPublishing
          ? (progress?.message || 'Publishing...')
          : isPublished
            ? 'Update Feed'
            : 'Publish to MSP'}
      </button>

      {/* Results */}
      {(feedUrl || publishResult?.feedUrl) && (
        <div style={{
          padding: '12px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '8px',
          border: '1px solid var(--success-color)'
        }}>
          {/* Feed URL */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--success-color)'
            }}>
              Publisher Feed URL
              {isNostrLinked && (
                <span style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  backgroundColor: 'rgba(139, 92, 246, 0.2)',
                  color: '#a78bfa',
                  borderRadius: '4px'
                }}>
                  Linked to Nostr
                </span>
              )}
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={feedUrl || publishResult?.feedUrl || ''}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--success-color)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  fontFamily: 'monospace'
                }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => copyToClipboard(feedUrl || publishResult?.feedUrl || '')}
                style={{ padding: '8px 12px' }}
              >
                Copy
              </button>
            </div>
          </div>

          {/* Podcast Index Link */}
          {(publishResult?.piPageUrl || publishResult?.piStatus === 'pending') && (
            <div style={{ paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
              <label style={{
                display: 'block',
                marginBottom: '4px',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                Podcast Index
              </label>
              {publishResult.piPageUrl ? (
                <a
                  href={publishResult.piPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '14px', color: '#3b82f6', wordBreak: 'break-all' }}
                >
                  {publishResult.piPageUrl}
                </a>
              ) : (
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
                  Feed submitted to Podcast Index. It may take a few minutes to appear.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Catalog Host Results */}
      {publishResult?.catalogHostResults && publishResult.catalogHostResults.length > 0 && (
        <div style={{
          marginTop: '16px',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontWeight: 500
          }}>
            Catalog Feed Hosting
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {publishResult.catalogHostResults.map((result, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  gap: '8px',
                  borderBottom: idx < publishResult.catalogHostResults!.length - 1 ? '1px solid var(--border-color)' : 'none'
                }}
              >
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  backgroundColor: result.status === 'hosted' ? 'var(--success-color)' :
                    result.status === 'skipped' ? 'var(--text-secondary)' :
                      'var(--danger-color)',
                  color: 'white'
                }}>
                  {result.status === 'hosted' ? '✓' :
                    result.status === 'skipped' ? '–' : '!'}
                </span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: '14px' }}>{result.title}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {result.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Catalog Update Results */}
      {publishResult?.catalogUpdateResults && publishResult.catalogUpdateResults.length > 0 && (
        <div style={{
          marginTop: '16px',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontWeight: 500
          }}>
            Publisher Reference Updates
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {publishResult.catalogUpdateResults.map((result, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 12px',
                  gap: '8px',
                  borderBottom: idx < publishResult.catalogUpdateResults!.length - 1 ? '1px solid var(--border-color)' : 'none'
                }}
              >
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  backgroundColor: result.status === 'updated' ? 'var(--success-color)' :
                    result.status === 'downloaded' ? 'var(--warning-color, #f59e0b)' :
                      'var(--danger-color)',
                  color: 'white'
                }}>
                  {result.status === 'updated' ? '✓' :
                    result.status === 'downloaded' ? '↓' : '!'}
                </span>
                <span style={{ flex: 1, fontWeight: 500, fontSize: '14px' }}>{result.title}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {result.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
